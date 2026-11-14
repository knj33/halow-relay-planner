/*
 * Relay Engine — native terrain streaming helper for the HaLow Relay Planner.
 *
 * A small localhost HTTP service that downloads and resamples terrain in parallel.
 * It is deliberately boring: bind 127.0.0.1, allow a short list of origins, return
 * a binary height grid. The browser remains the UI and the fallback.
 *
 * Build:  make
 * Run:    ./relay-engine [--port 8765] [--threads N] [--origin URL]...
 *
 * Endpoints:
 *   GET  /health          -> JSON status
 *   POST /terrain         -> binary HRG1 grid
 *   GET  /                -> human-readable status page
 *
 * Terrain request JSON:
 *   {"body":"earth"|"moon"|"mars","lat":45.8,"lon":6.8,"sizeM":20000,"n":257}
 *
 * Binary response (little-endian):
 *   char     magic[4] = "HRG1"
 *   uint32   version = 1
 *   uint32   cols
 *   uint32   rows
 *   float    widthM
 *   float    heightM
 *   float    minElevM
 *   float    maxElevM
 *   float    data[cols * rows]   row-major, metres
 */

#define _GNU_SOURCE
#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <netinet/in.h>
#include <png.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include <curl/curl.h>

#define ENGINE_VERSION "0.3.0"
#define MAX_TILES 64
#define MAX_PLAN 1024
#define MAX_GRID 2048
#define TILE_PX 256
#define BLOCK_COLS 2048
#define MAX_BODY (64 * 1024)
#define MAX_TILE_BYTES (4 * 1024 * 1024)
#define MAX_RANGE_BYTES (8 * 1024 * 1024)

#define D2R (M_PI / 180.0)

static int g_threads = 8;
static int g_port = 8765;
static const char *g_origins[32];
static int g_norigins = 0;

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

static double clampd(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }
static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

typedef struct {
    unsigned char *data;
    size_t len;
    size_t cap;
    size_t max;
    int overflow;
} Buf;

static void buf_init(Buf *b, size_t max) {
    memset(b, 0, sizeof(*b));
    b->max = max;
}

static int buf_reserve(Buf *b, size_t need) {
    if (need <= b->cap) return 0;
    if (b->max && need > b->max) {
        b->overflow = 1;
        return -1;
    }
    size_t cap = b->cap ? b->cap : 4096;
    while (cap < need) cap *= 2;
    if (b->max && cap > b->max) cap = b->max;
    unsigned char *p = realloc(b->data, cap);
    if (!p) return -1;
    b->data = p;
    b->cap = cap;
    return 0;
}

static void buf_free(Buf *b) {
    free(b->data);
    memset(b, 0, sizeof(*b));
}

static size_t write_cb(char *ptr, size_t size, size_t nmemb, void *userdata) {
    Buf *b = (Buf *)userdata;
    size_t n = size * nmemb;
    if (buf_reserve(b, b->len + n) != 0) return 0;
    memcpy(b->data + b->len, ptr, n);
    b->len += n;
    return n;
}

static int http_get(const char *url, const char *range, Buf *out) {
    buf_init(out, range ? MAX_RANGE_BYTES : MAX_TILE_BYTES);
    CURL *c = curl_easy_init();
    if (!c) return -1;

    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, out);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, 90L);
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, "halow-relay-engine/" ENGINE_VERSION);
    curl_easy_setopt(c, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    if (range) curl_easy_setopt(c, CURLOPT_RANGE, range);

    CURLcode rc = curl_easy_perform(c);
    long status = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_cleanup(c);

    if (rc != CURLE_OK || out->overflow) return -1;
    if (range) {
        /* A server that ignores Range would send the whole mosaic; refuse it. */
        if (status != 206) return -2;
    } else if (status != 200) {
        return -2;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* Thread pool                                                         */
/* ------------------------------------------------------------------ */

typedef struct {
    pthread_mutex_t mu;
    int next;
    int total;
    void (*work)(void *ctx, int index);
    void *ctx;
} Pool;

static void *pool_worker(void *arg) {
    Pool *p = (Pool *)arg;
    for (;;) {
        pthread_mutex_lock(&p->mu);
        int i = p->next++;
        pthread_mutex_unlock(&p->mu);
        if (i >= p->total) break;
        p->work(p->ctx, i);
    }
    return NULL;
}

static void pool_run(int nthreads, int total, void (*work)(void *, int), void *ctx) {
    if (total <= 0) return;
    if (nthreads > total) nthreads = total;
    if (nthreads < 1) nthreads = 1;

    Pool p;
    memset(&p, 0, sizeof(p));
    p.total = total;
    p.work = work;
    p.ctx = ctx;
    pthread_mutex_init(&p.mu, NULL);

    pthread_t *threads = calloc((size_t)nthreads, sizeof(*threads));
    int started = 0;
    if (threads) {
        for (int i = 0; i < nthreads - 1; i++) {
            if (pthread_create(&threads[started], NULL, pool_worker, &p) == 0) started++;
        }
    }
    pool_worker(&p);
    for (int i = 0; i < started; i++) pthread_join(threads[i], NULL);
    free(threads);
    pthread_mutex_destroy(&p.mu);
}

/* ------------------------------------------------------------------ */
/* Geodesy and tile maths (mirrors src/engine/terrain/geo.ts and real.ts) */
/* ------------------------------------------------------------------ */

typedef struct {
    double lat;
    double lon;
} Geo;

static double wrap_lon(double lon) {
    return fmod(fmod(lon + 180.0, 360.0) + 360.0, 360.0) - 180.0;
}

static Geo local_to_geo(Geo c, double east, double north, double R) {
    double d = hypot(east, north) / R;
    if (d == 0.0) {
        Geo out = {c.lat, wrap_lon(c.lon)};
        return out;
    }
    double az = atan2(east, north);
    double p0 = c.lat * D2R;
    double sin_lat = sin(p0) * cos(d) + cos(p0) * sin(d) * cos(az);
    sin_lat = clampd(sin_lat, -1.0, 1.0);
    double lat = asin(sin_lat);
    double lon = c.lon * D2R + atan2(sin(az) * sin(d) * cos(p0), cos(d) - sin(p0) * sin_lat);
    Geo out = {lat / D2R, wrap_lon(lon / D2R)};
    return out;
}

static void geo_to_tile(Geo p, int z, double *x, double *y) {
    double n = (double)(1 << z);
    double s = sin(clampd(p.lat, -85.0511, 85.0511) * D2R);
    *x = ((p.lon + 180.0) / 360.0) * n;
    *y = (0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * M_PI)) * n;
}

static double terrarium_to_metres(unsigned char r, unsigned char g, unsigned char b) {
    return (double)r * 256.0 + (double)g + (double)b / 256.0 - 32768.0;
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

typedef struct {
    int cols;
    int rows;
    double widthM;
    double heightM;
    float *data;
    float min;
    float max;
} Grid;

static Grid *grid_new(int cols, int rows, double widthM, double heightM) {
    Grid *g = calloc(1, sizeof(*g));
    if (!g) return NULL;
    g->cols = cols;
    g->rows = rows;
    g->widthM = widthM;
    g->heightM = heightM;
    g->data = calloc((size_t)cols * rows, sizeof(float));
    if (!g->data) {
        free(g);
        return NULL;
    }
    return g;
}

static void grid_finish(Grid *g) {
    float lo = INFINITY, hi = -INFINITY;
    size_t n = (size_t)g->cols * g->rows;
    for (size_t i = 0; i < n; i++) {
        float v = g->data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    g->min = lo;
    g->max = hi;
}

static void grid_free(Grid *g) {
    if (!g) return;
    free(g->data);
    free(g);
}

static Geo *grid_geo(Geo centre, double sizeM, double R, int n) {
    Geo *out = calloc((size_t)n * n, sizeof(Geo));
    if (!out) return NULL;
    for (int r = 0; r < n; r++) {
        double north = ((double)r / (n - 1) - 0.5) * sizeM;
        for (int c = 0; c < n; c++) {
            double east = ((double)c / (n - 1) - 0.5) * sizeM;
            out[(size_t)r * n + c] = local_to_geo(centre, east, north, R);
        }
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* PNG decode                                                          */
/* ------------------------------------------------------------------ */

static int decode_png(const unsigned char *data, size_t len, unsigned char **out, int *w, int *h) {
    png_image img;
    memset(&img, 0, sizeof(img));
    img.version = PNG_IMAGE_VERSION;
    if (!png_image_begin_read_from_memory(&img, data, len)) return -1;
    img.format = PNG_FORMAT_RGBA;
    size_t size = PNG_IMAGE_SIZE(img);
    unsigned char *buf = malloc(size);
    if (!buf) {
        png_image_free(&img);
        return -1;
    }
    if (!png_image_finish_read(&img, NULL, buf, 0, NULL)) {
        free(buf);
        png_image_free(&img);
        return -1;
    }
    *out = buf;
    *w = (int)img.width;
    *h = (int)img.height;
    png_image_free(&img);
    return 0;
}

/* ------------------------------------------------------------------ */
/* Earth: Terrarium tiles                                              */
/* ------------------------------------------------------------------ */

typedef struct {
    int z;
    int tilesN;
    int count;
    int kx[MAX_TILES];
    int ky[MAX_TILES];
    int width[MAX_TILES];
    int height[MAX_TILES];
    unsigned char *rgba[MAX_TILES];
    int ok[MAX_TILES];
} TileCtx;

static int find_tile(const TileCtx *c, int kx, int ky) {
    for (int i = 0; i < c->count; i++) {
        if (c->kx[i] == kx && c->ky[i] == ky) return i;
    }
    return -1;
}

static void tile_work(void *vctx, int index) {
    TileCtx *c = (TileCtx *)vctx;
    int wx = ((c->kx[index] % c->tilesN) + c->tilesN) % c->tilesN;
    int wy = c->ky[index];
    char url[512];
    snprintf(url, sizeof(url),
             "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png",
             c->z, wx, wy);
    Buf b;
    if (http_get(url, NULL, &b) != 0) {
        buf_free(&b);
        return;
    }
    unsigned char *rgba = NULL;
    int w = 0, h = 0;
    if (decode_png(b.data, b.len, &rgba, &w, &h) == 0) {
        c->rgba[index] = rgba;
        c->width[index] = w;
        c->height[index] = h;
        c->ok[index] = 1;
    }
    buf_free(&b);
}

static int zoom_for_resolution(double lat, double target, double R, int maxZoom) {
    double z0 = (2.0 * M_PI * R * cos(lat * D2R)) / TILE_PX;
    int z = (int)ceil(log2(z0 / target));
    return clampi(z, 0, maxZoom);
}

/*
 * Build the unique tile list for a zoom. Returns 0 on success, -1 if the
 * list exceeds MAX_PLAN (caller should decrease zoom).
 */
static int plan_tiles(const Geo *geo, int n, Geo centre, int z,
                      double *tx, double *ty, int *kx, int *ky, int *count_out) {
    double tilesN = (double)(1 << z);
    double centreTx, centreTy;
    geo_to_tile(centre, z, &centreTx, &centreTy);
    (void)centreTy;

    int count = 0;
    for (int i = 0; i < n * n; i++) {
        double x, y;
        geo_to_tile(geo[i], z, &x, &y);
        if (x - centreTx > tilesN / 2.0) x -= tilesN;
        else if (centreTx - x > tilesN / 2.0) x += tilesN;
        tx[i] = x;
        ty[i] = y;

        for (int oxi = 0; oxi < 2; oxi++) {
            double ox = oxi == 0 ? -0.5 / TILE_PX : 0.5 / TILE_PX;
            for (int oyi = 0; oyi < 2; oyi++) {
                double oy = oyi == 0 ? -0.5 / TILE_PX : 0.5 / TILE_PX;
                int ikx = (int)floor(x + ox);
                int iky = clampi((int)floor(y + oy), 0, (int)tilesN - 1);
                int found = 0;
                for (int k = 0; k < count; k++) {
                    if (kx[k] == ikx && ky[k] == iky) {
                        found = 1;
                        break;
                    }
                }
                if (!found) {
                    if (count >= MAX_PLAN) return -1;
                    kx[count] = ikx;
                    ky[count] = iky;
                    count++;
                }
            }
        }
    }
    *count_out = count;
    return 0;
}

static double sample_tile(const TileCtx *c, int gx, int gy) {
    int kx = (int)floor((double)gx / TILE_PX);
    int ky = clampi((int)floor((double)gy / TILE_PX), 0, c->tilesN - 1);
    int ki = find_tile(c, kx, ky);
    if (ki < 0 || !c->ok[ki]) return 0.0;

    double sx = (double)c->width[ki] / TILE_PX;
    double sy = (double)c->height[ki] / TILE_PX;
    int ix = clampi((int)floor((gx - kx * TILE_PX) * sx), 0, c->width[ki] - 1);
    int iy = clampi((int)floor((gy - ky * TILE_PX) * sy), 0, c->height[ki] - 1);
    const unsigned char *p = c->rgba[ki] + ((size_t)iy * c->width[ki] + ix) * 4;
    return terrarium_to_metres(p[0], p[1], p[2]);
}

static Grid *load_earth(Geo centre, double sizeM, int n, int *zoom_out, double *mpp_out) {
    const double R = 6371000.0;
    Geo *geo = grid_geo(centre, sizeM, R, n);
    if (!geo) return NULL;

    double target = sizeM / (n - 1);
    int z = zoom_for_resolution(centre.lat, target, R, 14);
    double *tx = calloc((size_t)n * n, sizeof(double));
    double *ty = calloc((size_t)n * n, sizeof(double));
    int *kx = calloc(MAX_PLAN, sizeof(int));
    int *ky = calloc(MAX_PLAN, sizeof(int));
    int count = 0;
    if (!tx || !ty || !kx || !ky) {
        free(geo); free(tx); free(ty); free(kx); free(ky);
        return NULL;
    }

    for (;;) {
        if (plan_tiles(geo, n, centre, z, tx, ty, kx, ky, &count) == 0 && count <= MAX_TILES) break;
        if (z == 0) {
            free(geo); free(tx); free(ty); free(kx); free(ky);
            return NULL;
        }
        z--;
    }

    TileCtx ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.z = z;
    ctx.tilesN = 1 << z;
    ctx.count = count;
    memcpy(ctx.kx, kx, (size_t)count * sizeof(int));
    memcpy(ctx.ky, ky, (size_t)count * sizeof(int));

    pool_run(g_threads, count, tile_work, &ctx);
    int complete = 1;
    for (int i = 0; i < count; i++) if (!ctx.ok[i]) complete = 0;

    Grid *g = complete ? grid_new(n, n, sizeM, sizeM) : NULL;
    if (g) {
        for (int i = 0; i < n * n; i++) {
            double fx = tx[i] * TILE_PX - 0.5;
            double fy = ty[i] * TILE_PX - 0.5;
            int x0 = (int)floor(fx);
            int y0 = (int)floor(fy);
            double ax = fx - x0;
            double ay = fy - y0;
            double v = (sample_tile(&ctx, x0, y0) * (1 - ax) + sample_tile(&ctx, x0 + 1, y0) * ax) * (1 - ay) +
                       (sample_tile(&ctx, x0, y0 + 1) * (1 - ax) + sample_tile(&ctx, x0 + 1, y0 + 1) * ax) * ay;
            g->data[i] = (float)v;
        }
        grid_finish(g);
    }

    for (int i = 0; i < count; i++) free(ctx.rgba[i]);
    free(geo);
    free(tx);
    free(ty);
    free(kx);
    free(ky);
    if (zoom_out) *zoom_out = z;
    if (mpp_out) *mpp_out = ((2.0 * M_PI * R) / (TILE_PX * (double)(1 << z))) * cos(centre.lat * D2R);
    return g;
}

/* ------------------------------------------------------------------ */
/* Moon and Mars: global GeoTIFF mosaic range reads                    */
/* ------------------------------------------------------------------ */

typedef struct {
    int width;
    int height;
    uint64_t dataOffset;
    int littleEndian;
    double scale;
    int hasNoData;
    int noData;
} Tiff;

static uint16_t rd16(const unsigned char *p, int le) {
    return le ? (uint16_t)(p[0] | (p[1] << 8)) : (uint16_t)((p[0] << 8) | p[1]);
}

static uint32_t rd32(const unsigned char *p, int le) {
    if (le) return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static uint64_t rd64(const unsigned char *p, int le) {
    uint64_t v = 0;
    if (le) {
        for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
    } else {
        for (int i = 0; i < 8; i++) v = (v << 8) | p[i];
    }
    return v;
}

static int range_get(const char *url, uint64_t start, size_t len, Buf *out) {
    char range[96];
    snprintf(range, sizeof(range), "%llu-%llu", (unsigned long long)start,
             (unsigned long long)(start + len - 1));
    return http_get(url, range, out);
}

typedef struct {
    uint16_t tag;
    uint16_t type;
    uint64_t count;
    size_t valueAt;
} Tag;

static const Tag *find_tag(const Tag *tags, int n, uint16_t tag) {
    for (int i = 0; i < n; i++) {
        if (tags[i].tag == tag) return &tags[i];
    }
    return NULL;
}

static int tag_scalar(const unsigned char *ifd, const Tag *t, int le, uint64_t *out) {
    if (!t) return -1;
    if (t->type == 3) {
        *out = rd16(ifd + t->valueAt, le);
        return 0;
    }
    if (t->type == 4) {
        *out = rd32(ifd + t->valueAt, le);
        return 0;
    }
    if (t->type == 16) {
        *out = rd64(ifd + t->valueAt, le);
        return 0;
    }
    return -1;
}

static int tag_text(const char *url, const unsigned char *ifd, const Tag *t, int le, int big,
                    char *out, size_t cap) {
    if (!t) return -1;
    size_t elem = 1;
    if (t->type == 2) elem = 1;
    else if (t->type == 3) elem = 2;
    else if (t->type == 4) elem = 4;
    else if (t->type == 16) elem = 8;
    size_t bytes = (size_t)t->count * elem;
    if (bytes == 0 || bytes >= cap) return -1;
    size_t inline_cap = big ? 8 : 4;
    if (bytes <= inline_cap) {
        memcpy(out, ifd + t->valueAt, bytes);
    } else {
        uint64_t off = big ? rd64(ifd + t->valueAt, le) : rd32(ifd + t->valueAt, le);
        Buf b;
        if (range_get(url, off, bytes, &b) != 0) {
            buf_free(&b);
            return -1;
        }
        memcpy(out, b.data, bytes);
        buf_free(&b);
    }
    out[bytes] = '\0';
    return 0;
}

static int tiff_open(const char *url, Tiff *t) {
    memset(t, 0, sizeof(*t));
    Buf h;
    if (range_get(url, 0, 16, &h) != 0) {
        buf_free(&h);
        return -1;
    }
    if (h.len < 8) {
        buf_free(&h);
        return -1;
    }
    int le = rd16(h.data, 1) == 0x4949;
    int magic = rd16(h.data + 2, le);
    int big = magic == 43;
    uint64_t ifd = big ? rd64(h.data + 8, le) : rd32(h.data + 4, le);
    buf_free(&h);

    int entry = big ? 20 : 12;
    size_t ifd_len = (big ? 8 : 2) + (size_t)entry * 64;
    Buf d;
    if (range_get(url, ifd, ifd_len, &d) != 0) {
        buf_free(&d);
        return -1;
    }
    uint64_t count64 = big ? rd64(d.data, le) : rd16(d.data, le);
    int count = count64 > 64 ? 64 : (int)count64;
    Tag tags[64];
    memset(tags, 0, sizeof(tags));
    for (int i = 0; i < count; i++) {
        size_t o = (big ? 8 : 2) + (size_t)i * entry;
        if (o + entry > d.len) break;
        tags[i].tag = rd16(d.data + o, le);
        tags[i].type = rd16(d.data + o + 2, le);
        tags[i].count = big ? rd64(d.data + o + 4, le) : rd32(d.data + o + 4, le);
        tags[i].valueAt = o + (big ? 12 : 8);
    }

    uint64_t width = 0, height = 0, bits = 0, compression = 0, samples = 1, rows_per_strip = 0, sample_format = 0;
    if (tag_scalar(d.data, find_tag(tags, count, 256), le, &width) != 0 || width == 0) goto fail;
    if (tag_scalar(d.data, find_tag(tags, count, 257), le, &height) != 0 || height == 0) goto fail;
    if (tag_scalar(d.data, find_tag(tags, count, 258), le, &bits) != 0 || bits != 16) goto fail;
    if (tag_scalar(d.data, find_tag(tags, count, 259), le, &compression) != 0 || compression != 1) goto fail;
    if (tag_scalar(d.data, find_tag(tags, count, 277), le, &samples) != 0 || samples != 1) goto fail;
    if (tag_scalar(d.data, find_tag(tags, count, 278), le, &rows_per_strip) != 0 || rows_per_strip != 1) goto fail;
    if (tag_scalar(d.data, find_tag(tags, count, 339), le, &sample_format) != 0 || sample_format != 2) goto fail;

    const Tag *so = find_tag(tags, count, 273);
    if (!so) goto fail;
    size_t so_size = so->type == 16 ? 8 : 4;
    uint64_t so_at = big ? rd64(d.data + so->valueAt, le) : rd32(d.data + so->valueAt, le);

    Buf first_b, last_b;
    if (range_get(url, so_at, so_size, &first_b) != 0) {
        buf_free(&first_b);
        goto fail;
    }
    if (range_get(url, so_at + (uint64_t)(height - 1) * so_size, so_size, &last_b) != 0) {
        buf_free(&first_b);
        buf_free(&last_b);
        goto fail;
    }
    uint64_t first = so_size == 8 ? rd64(first_b.data, le) : rd32(first_b.data, le);
    uint64_t last = so_size == 8 ? rd64(last_b.data, le) : rd32(last_b.data, le);
    buf_free(&first_b);
    buf_free(&last_b);
    if (last != first + (height - 1) * width * 2ULL) goto fail;

    char meta[4096];
    meta[0] = '\0';
    double scale = 1.0;
    if (tag_text(url, d.data, find_tag(tags, count, 42112), le, big, meta, sizeof(meta)) == 0) {
        const char *p = strstr(meta, "role=\"scale\"");
        if (p) {
            p = strchr(p, '>');
            if (p) scale = strtod(p + 1, NULL);
        }
    }

    char nd[128];
    nd[0] = '\0';
    int has_no_data = 0;
    int no_data = 0;
    if (tag_text(url, d.data, find_tag(tags, count, 42113), le, big, nd, sizeof(nd)) == 0 && nd[0]) {
        no_data = (int)strtol(nd, NULL, 10);
        has_no_data = 1;
    }

    t->width = (int)width;
    t->height = (int)height;
    t->dataOffset = first;
    t->littleEndian = le;
    t->scale = scale;
    t->hasNoData = has_no_data;
    t->noData = no_data;
    buf_free(&d);
    return 0;

fail:
    buf_free(&d);
    return -1;
}

typedef struct {
    const char *url;
    const Tiff *t;
    int *rows;
    int nrows;
    int x0;
    int width;
    float *rowbuf; /* nrows * width */
    int *ok;
} MosaicCtx;

static void mosaic_work(void *vctx, int index) {
    MosaicCtx *c = (MosaicCtx *)vctx;
    int y = c->rows[index];
    size_t len = (size_t)c->width * 2;
    uint64_t start = c->t->dataOffset + ((uint64_t)y * c->t->width + c->x0) * 2ULL;
    Buf b;
    if (range_get(c->url, start, len, &b) != 0 || b.len < len) {
        buf_free(&b);
        return;
    }
    float *row = c->rowbuf + (size_t)index * c->width;
    for (int i = 0; i < c->width; i++) {
        int16_t v = (int16_t)rd16(b.data + (size_t)i * 2, c->t->littleEndian);
        if (c->t->hasNoData && v == c->t->noData) {
            buf_free(&b);
            return; /* Missing samples must never masquerade as zero elevation. */
        }
        row[i] = (float)(v * c->t->scale);
    }
    c->ok[index] = 1;
    buf_free(&b);
}

static int row_index(const MosaicCtx *c, int y) {
    int lo = 0, hi = c->nrows - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (c->rows[mid] == y) return mid;
        if (c->rows[mid] < y) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/*
 * Resample a global simple-cylindrical mosaic (west edge -180, top +90) into the local grid.
 * Used for the Moon (LOLA) and Mars (HRSC + MOLA, MOLA). Mirrors loadEquirectRegion in real.ts.
 */
static Grid *load_mosaic(const char *url, double R, Geo centre, double sizeM, int n, int *rows_out) {
    Tiff t;
    if (tiff_open(url, &t) != 0) return NULL;

    Geo *geo = grid_geo(centre, sizeM, R, n);
    if (!geo) return NULL;

    double *fx = calloc((size_t)n * n, sizeof(double));
    double *fy = calloc((size_t)n * n, sizeof(double));
    if (!fx || !fy) {
        free(geo); free(fx); free(fy);
        return NULL;
    }

    double centreFx = ((wrap_lon(centre.lon - (-180.0) - 180.0) + 180.0) / 360.0) * t.width;
    double minX = INFINITY, maxX = -INFINITY, minY = INFINITY, maxY = -INFINITY;
    for (int i = 0; i < n * n; i++) {
        double x = ((wrap_lon(geo[i].lon - (-180.0) - 180.0) + 180.0) / 360.0) * t.width;
        if (x - centreFx > t.width / 2.0) x -= t.width;
        else if (centreFx - x > t.width / 2.0) x += t.width;
        fx[i] = x - 0.5;
        fy[i] = clampd(((90.0 - geo[i].lat) / 180.0) * t.height - 0.5, 0.0, t.height - 1.0);
        if (fx[i] < minX) minX = fx[i];
        if (fx[i] > maxX) maxX = fx[i];
        if (fy[i] < minY) minY = fy[i];
        if (fy[i] > maxY) maxY = fy[i];
    }
    int x0 = (int)floor(minX);
    int x1 = (int)floor(maxX) + 2;
    if (x0 < 0 || x1 > t.width) {
        free(geo); free(fx); free(fy);
        return NULL;
    }
    int decimate = (maxY - minY) / (n - 1) > 1.5;

    unsigned char *needed = calloc((size_t)t.height, 1);
    if (!needed) {
        free(geo); free(fx); free(fy);
        return NULL;
    }
    for (int i = 0; i < n * n; i++) {
        if (decimate) {
            int y = (int)lround(fy[i]);
            needed[clampi(y, 0, t.height - 1)] = 1;
        } else {
            int ya = (int)floor(fy[i]);
            needed[clampi(ya, 0, t.height - 1)] = 1;
            needed[clampi(ya + 1, 0, t.height - 1)] = 1;
        }
    }
    int nrows = 0;
    for (int y = 0; y < t.height; y++) nrows += needed[y];
    int *rows = calloc((size_t)nrows, sizeof(int));
    if (!rows) {
        free(needed); free(geo); free(fx); free(fy);
        return NULL;
    }
    int ri = 0;
    for (int y = 0; y < t.height; y++) {
        if (needed[y]) rows[ri++] = y;
    }
    free(needed);

    int width = x1 - x0;
    MosaicCtx ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.url = url;
    ctx.t = &t;
    ctx.rows = rows;
    ctx.nrows = nrows;
    ctx.x0 = x0;
    ctx.width = width;
    ctx.rowbuf = calloc((size_t)nrows * width, sizeof(float));
    ctx.ok = calloc((size_t)nrows, sizeof(int));
    if (!ctx.rowbuf || !ctx.ok) {
        free(ctx.rowbuf); free(ctx.ok); free(rows); free(geo); free(fx); free(fy);
        return NULL;
    }

    pool_run(g_threads, nrows, mosaic_work, &ctx);
    int complete = 1;
    for (int i = 0; i < nrows; i++) if (!ctx.ok[i]) complete = 0;

    Grid *g = complete ? grid_new(n, n, sizeM, sizeM) : NULL;
    if (g) {
        for (int i = 0; i < n * n; i++) {
            int xa = (int)floor(fx[i]);
            double ax = fx[i] - xa;
            double v;
            if (decimate) {
                int y = clampi((int)lround(fy[i]), 0, t.height - 1);
                int rr = row_index(&ctx, y);
                double a = rr >= 0 ? ctx.rowbuf[(size_t)rr * width + (xa - x0)] : 0.0;
                double b = rr >= 0 ? ctx.rowbuf[(size_t)rr * width + (xa + 1 - x0)] : 0.0;
                v = a * (1 - ax) + b * ax;
            } else {
                int ya = clampi((int)floor(fy[i]), 0, t.height - 1);
                int yb = clampi(ya + 1, 0, t.height - 1);
                double ay = fy[i] - ya;
                int ra = row_index(&ctx, ya);
                int rb = row_index(&ctx, yb);
                double a0 = ra >= 0 ? ctx.rowbuf[(size_t)ra * width + (xa - x0)] : 0.0;
                double a1 = ra >= 0 ? ctx.rowbuf[(size_t)ra * width + (xa + 1 - x0)] : 0.0;
                double b0 = rb >= 0 ? ctx.rowbuf[(size_t)rb * width + (xa - x0)] : 0.0;
                double b1 = rb >= 0 ? ctx.rowbuf[(size_t)rb * width + (xa + 1 - x0)] : 0.0;
                v = (a0 * (1 - ax) + a1 * ax) * (1 - ay) + (b0 * (1 - ax) + b1 * ax) * ay;
            }
            g->data[i] = (float)v;
        }
        grid_finish(g);
    }

    free(ctx.rowbuf);
    free(ctx.ok);
    free(rows);
    free(geo);
    free(fx);
    free(fy);
    if (rows_out) *rows_out = nrows;
    return g;
}

/* Elevation mosaics per body, best first. Ids match src/terrain/sources.ts. */
typedef struct {
    const char *id;
    const char *url;
} Mosaic;

#define ASC_MOSAIC "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/"

static const Mosaic MOON_MOSAICS[] = {
    {"moon-lola-118m", ASC_MOSAIC "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"},
};

static const Mosaic MARS_MOSAICS[] = {
    {"mars-hrsc-mola-200m", ASC_MOSAIC "Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"},
    {"mars-mola-463m", ASC_MOSAIC "Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"},
};

/* Try each mosaic in turn; report which one produced the grid. */
static Grid *load_body_mosaic(const Mosaic *list, int count, double R, Geo centre, double sizeM, int n,
                              int *rows_out, const char **source_out) {
    for (int i = 0; i < count; i++) {
        Grid *g = load_mosaic(list[i].url, R, centre, sizeM, n, rows_out);
        if (g) {
            if (source_out) *source_out = list[i].id;
            return g;
        }
    }
    return NULL;
}

/* ------------------------------------------------------------------ */
/* JSON parsing (only the handful of fields we define)                 */
/* ------------------------------------------------------------------ */

static const char *json_value(const char *s, const char *key) {
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(s, pat);
    if (!p) return NULL;
    p = strchr(p + strlen(pat), ':');
    if (!p) return NULL;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    return p;
}

static int json_num(const char *s, const char *key, double *out) {
    const char *p = json_value(s, key);
    if (!p) return 0;
    char *end = NULL;
    double v = strtod(p, &end);
    if (end == p) return 0;
    *out = v;
    return 1;
}

static int json_str(const char *s, const char *key, char *out, size_t cap) {
    const char *p = json_value(s, key);
    if (!p || *p != '"') return 0;
    p++;
    const char *e = strchr(p, '"');
    if (!e) return 0;
    size_t n = (size_t)(e - p);
    if (n >= cap) n = cap - 1;
    memcpy(out, p, n);
    out[n] = '\0';
    return 1;
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

static int origin_allowed(const char *origin) {
    if (!origin || !*origin) return 1;
    for (int i = 0; i < g_norigins; i++) {
        if (strcmp(origin, g_origins[i]) == 0) return 1;
    }
    return 0;
}

static int send_all(int fd, const void *data, size_t len) {
    const unsigned char *p = data;
    while (len > 0) {
        ssize_t n = send(fd, p, len, 0);
        if (n <= 0) return -1;
        p += n;
        len -= (size_t)n;
    }
    return 0;
}

static void send_response(int fd, int status, const char *status_text, const char *content_type,
                          const void *body, size_t len, const char *origin,
                          const char *extra_headers) {
    char head[2048];
    int n = snprintf(head, sizeof(head),
                     "HTTP/1.1 %d %s\r\n"
                     "Content-Type: %s\r\n"
                     "Content-Length: %zu\r\n"
                     "Access-Control-Allow-Origin: %s\r\n"
                     "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                     "Access-Control-Allow-Headers: Content-Type\r\n"
                     "Access-Control-Expose-Headers: X-Engine-Zoom, X-Engine-Mpp, X-Engine-Ms, X-Engine-Source\r\n"
                     "Access-Control-Allow-Private-Network: true\r\n"
                     "Access-Control-Max-Age: 86400\r\n"
                     "Vary: Origin\r\n"
                     "Connection: close\r\n"
                     "%s"
                     "\r\n",
                     status, status_text, content_type, len,
                     (origin && *origin) ? origin : "*",
                     extra_headers ? extra_headers : "");
    send_all(fd, head, (size_t)n);
    if (body && len) send_all(fd, body, len);
}

static void send_json(int fd, int status, const char *status_text, const char *json, const char *origin) {
    send_response(fd, status, status_text, "application/json", json, strlen(json), origin, NULL);
}

static size_t header_value(const char *req, const char *name, char *out, size_t cap);

/**
 * Read one request. Waits for the header terminator, then keeps reading until the
 * declared Content-Length body has arrived: a POST body can easily land in a
 * second TCP segment.
 */
static int read_request(int fd, char *buf, size_t cap, size_t *out_len) {
    size_t len = 0;
    size_t need = 0;
    int have_header = 0;
    while (len + 1 < cap) {
        ssize_t n = recv(fd, buf + len, cap - len - 1, 0);
        if (n <= 0) break;
        len += (size_t)n;
        buf[len] = '\0';

        if (!have_header) {
            char *end = strstr(buf, "\r\n\r\n");
            if (end) {
                char clen_s[32];
                header_value(buf, "Content-Length", clen_s, sizeof(clen_s));
                unsigned long clen = clen_s[0] ? strtoul(clen_s, NULL, 10) : 0;
                need = (size_t)(end - buf) + 4 + (size_t)clen;
                if (need > cap) return -1;
                have_header = 1;
            }
        }
        if (have_header && len >= need) break;
    }
    *out_len = len;
    return len > 0 ? 0 : -1;
}

static size_t header_value(const char *req, const char *name, char *out, size_t cap) {
    size_t nlen = strlen(name);
    const char *p = req;
    while ((p = strcasestr(p, name)) != NULL) {
        if (p == req || p[-1] == '\n') {
            p += nlen;
            if (*p == ':') {
                p++;
                while (*p == ' ' || *p == '\t') p++;
                const char *e = strstr(p, "\r\n");
                if (!e) e = p + strlen(p);
                size_t n = (size_t)(e - p);
                if (n >= cap) n = cap - 1;
                memcpy(out, p, n);
                out[n] = '\0';
                return n;
            }
        }
        p += nlen;
    }
    out[0] = '\0';
    return 0;
}

static int is_method(const char *req, const char *method) {
    size_t n = strlen(method);
    return strncmp(req, method, n) == 0 && req[n] == ' ';
}

static void handle_terrain(int fd, const char *body, const char *origin) {
    double lat = 0, lon = 0, sizeM = 20000, nval = 257;
    char which[16] = "earth";
    if (!json_str(body, "body", which, sizeof(which)) || !json_num(body, "lat", &lat) ||
        !json_num(body, "lon", &lon) || !json_num(body, "sizeM", &sizeM) || !json_num(body, "n", &nval)) {
        send_json(fd, 400, "Bad Request", "{\"error\":\"missing or invalid terrain fields\"}", origin);
        return;
    }

    int earth = strcmp(which, "earth") == 0;
    int moon = strcmp(which, "moon") == 0;
    int mars = strcmp(which, "mars") == 0;
    /* Limits mirror NATIVE_AREA_LIMITS in src/engine/area.ts. */
    if ((!earth && !moon && !mars) || !isfinite(lat) || !isfinite(lon) ||
        !isfinite(sizeM) || !isfinite(nval) || fabs(lat) > 84 || fabs(lon) > 180 ||
        sizeM < 1000 || sizeM > (earth ? 300000 : 120000) ||
        nval < 65 || nval > (earth ? 1537 : 769) || nval != floor(nval)) {
        send_json(fd, 400, "Bad Request", "{\"error\":\"invalid terrain request or unsupported area/grid size\"}", origin);
        return;
    }
    int n = (int)nval;
    Geo centre = {lat, lon};

    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    int zoom = 0, rows = 0;
    double mpp = 0;
    const char *source = "earth-terrarium";
    Grid *g;
    if (moon)
        g = load_body_mosaic(MOON_MOSAICS, (int)(sizeof(MOON_MOSAICS) / sizeof(MOON_MOSAICS[0])), 1737400.0,
                             centre, sizeM, n, &rows, &source);
    else if (mars)
        g = load_body_mosaic(MARS_MOSAICS, (int)(sizeof(MARS_MOSAICS) / sizeof(MARS_MOSAICS[0])), 3389500.0,
                             centre, sizeM, n, &rows, &source);
    else
        g = load_earth(centre, sizeM, n, &zoom, &mpp);
    if (!g) {
        send_json(fd, 502, "Bad Gateway",
                  "{\"error\":\"terrain source unavailable\"}", origin);
        return;
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    long ms = (long)((t1.tv_sec - t0.tv_sec) * 1000 + (t1.tv_nsec - t0.tv_nsec) / 1000000);

    size_t data_bytes = (size_t)g->cols * g->rows * sizeof(float);
    size_t total = 32 + data_bytes;
    unsigned char *out = malloc(total);
    if (!out) {
        grid_free(g);
        send_json(fd, 500, "Internal Server Error", "{\"error\":\"out of memory\"}", origin);
        return;
    }
    memcpy(out, "HRG1", 4);
    uint32_t version = 1, cols = (uint32_t)g->cols, rws = (uint32_t)g->rows;
    memcpy(out + 4, &version, 4);
    memcpy(out + 8, &cols, 4);
    memcpy(out + 12, &rws, 4);
    float w = (float)g->widthM, h = (float)g->heightM, mn = g->min, mx = g->max;
    memcpy(out + 16, &w, 4);
    memcpy(out + 20, &h, 4);
    memcpy(out + 24, &mn, 4);
    memcpy(out + 28, &mx, 4);
    memcpy(out + 32, g->data, data_bytes);

    char extra[512];
    snprintf(extra, sizeof(extra),
             "X-Engine-Source: %s\r\n"
             "X-Engine-Zoom: %d\r\n"
             "X-Engine-Mpp: %.3f\r\n"
             "X-Engine-Rows: %d\r\n"
             "X-Engine-Ms: %ld\r\n"
             "Access-Control-Expose-Headers: X-Engine-Source, X-Engine-Zoom, X-Engine-Mpp, X-Engine-Rows, X-Engine-Ms\r\n",
             source, zoom, mpp, rows, ms);

    send_response(fd, 200, "OK", "application/octet-stream", out, total, origin, extra);
    free(out);
    grid_free(g);
}

static void handle_client(int fd, const char *origin_override) {
    char req[MAX_BODY + 4096];
    size_t len = 0;
    if (read_request(fd, req, sizeof(req), &len) != 0) {
        close(fd);
        return;
    }

    char origin[256];
    header_value(req, "Origin", origin, sizeof(origin));
    if (!origin[0] && origin_override) snprintf(origin, sizeof(origin), "%s", origin_override);

    if (!origin_allowed(origin)) {
        send_json(fd, 403, "Forbidden", "{\"error\":\"origin not allowed\"}", NULL);
        close(fd);
        return;
    }

    if (is_method(req, "OPTIONS")) {
        send_response(fd, 204, "No Content", "text/plain", NULL, 0, origin, NULL);
        close(fd);
        return;
    }

    if (is_method(req, "GET") && strncmp(req + 4, "/health", 7) == 0) {
        char json[512];
        snprintf(json, sizeof(json),
                 "{\"ok\":true,\"name\":\"relay-engine\",\"version\":\"%s\","
                 "\"arch\":\"x86_64\",\"avx2\":%s,\"threads\":%d,\"pid\":%d,"
                 "\"bodies\":[\"earth\",\"moon\",\"mars\"]}",
                 ENGINE_VERSION,
#if defined(__AVX2__)
                 "true",
#else
                 "false",
#endif
                 g_threads, (int)getpid());
        send_json(fd, 200, "OK", json, origin);
        close(fd);
        return;
    }

    if (is_method(req, "GET") && (strncmp(req + 4, "/ ", 2) == 0 || strncmp(req + 4, "/", 1) == 0)) {
        const char *html =
            "<!doctype html><meta charset=utf-8><title>Relay Engine</title>"
            "<style>body{font:15px system-ui;background:#0a0d13;color:#e6eaf2;max-width:640px;"
            "margin:60px auto;padding:0 20px}a{color:#58b4e8}code{background:#171d29;padding:2px 5px;"
            "border-radius:4px}</style><h1>Relay Engine</h1><p>Running. The planner can now use native "
            "terrain streaming.</p><p><code>GET /health</code> · <code>POST /terrain</code></p>";
        send_response(fd, 200, "OK", "text/html; charset=utf-8", html, strlen(html), origin, NULL);
        close(fd);
        return;
    }

    if (is_method(req, "POST") && strncmp(req + 5, "/terrain", 8) == 0) {
        char clen_s[32];
        header_value(req, "Content-Length", clen_s, sizeof(clen_s));
        long clen = clen_s[0] ? strtol(clen_s, NULL, 10) : 0;
        char *body = strstr(req, "\r\n\r\n");
        if (!body) {
            send_json(fd, 400, "Bad Request", "{\"error\":\"missing body\"}", origin);
            close(fd);
            return;
        }
        body += 4;
        size_t have = len - (size_t)(body - req);
        (void)clen;
        if (have == 0) {
            send_json(fd, 400, "Bad Request", "{\"error\":\"empty body\"}", origin);
            close(fd);
            return;
        }
        handle_terrain(fd, body, origin);
        close(fd);
        return;
    }

    send_json(fd, 404, "Not Found", "{\"error\":\"not found\"}", origin);
    close(fd);
}

typedef struct {
    int fd;
    char origin[256];
} ClientArg;

static void *client_thread(void *arg) {
    ClientArg *a = (ClientArg *)arg;
    handle_client(a->fd, a->origin[0] ? a->origin : NULL);
    free(a);
    return NULL;
}

int main(int argc, char **argv) {
    signal(SIGPIPE, SIG_IGN);
    curl_global_init(CURL_GLOBAL_DEFAULT);

    g_threads = (int)sysconf(_SC_NPROCESSORS_ONLN);
    if (g_threads < 1) g_threads = 4;
    if (g_threads > 32) g_threads = 32;

    g_origins[g_norigins++] = "http://localhost:5173";
    g_origins[g_norigins++] = "http://127.0.0.1:5173";
    g_origins[g_norigins++] = "http://localhost:4173";
    g_origins[g_norigins++] = "http://127.0.0.1:4173";

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            g_port = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--threads") == 0 && i + 1 < argc) {
            g_threads = clampi(atoi(argv[++i]), 1, 32);
        } else if (strcmp(argv[i], "--origin") == 0 && i + 1 < argc) {
            if (g_norigins < (int)(sizeof(g_origins) / sizeof(g_origins[0]))) {
                g_origins[g_norigins++] = argv[++i];
            }
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("relay-engine %s\n", ENGINE_VERSION);
            printf("usage: %s [--port N] [--threads N] [--origin URL]...\n", argv[0]);
            return 0;
        }
    }

    int sfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sfd < 0) {
        perror("socket");
        return 1;
    }
    int one = 1;
    setsockopt(sfd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)g_port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    if (bind(sfd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        perror("bind");
        close(sfd);
        return 1;
    }
    if (listen(sfd, 32) != 0) {
        perror("listen");
        close(sfd);
        return 1;
    }

    printf("relay-engine %s listening on http://127.0.0.1:%d (%d threads)\n",
           ENGINE_VERSION, g_port, g_threads);
    fflush(stdout);

    for (;;) {
        struct sockaddr_in peer;
        socklen_t plen = sizeof(peer);
        int cfd = accept(sfd, (struct sockaddr *)&peer, &plen);
        if (cfd < 0) {
            if (errno == EINTR) continue;
            break;
        }
        struct timeval tv = {30, 0};
        setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        setsockopt(cfd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

        ClientArg *arg = calloc(1, sizeof(*arg));
        if (!arg) {
            close(cfd);
            continue;
        }
        arg->fd = cfd;
        pthread_t tid;
        if (pthread_create(&tid, NULL, client_thread, arg) == 0) {
            pthread_detach(tid);
        } else {
            free(arg);
            close(cfd);
        }
    }

    close(sfd);
    curl_global_cleanup();
    return 0;
}
