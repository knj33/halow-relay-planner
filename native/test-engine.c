/* Deterministic native regression tests: no remote downloads. */
#include <assert.h>
#include <pthread.h>
#include <curl/curl.h>
#include <sys/socket.h>
static ssize_t test_send(int, const void *, size_t, int);
static int test_pthread_create(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static CURLcode test_curl_easy_perform(CURL *);
#define pthread_create test_pthread_create
#define curl_easy_perform test_curl_easy_perform
#define send test_send
#define main relay_engine_main
#include "relay-engine.c"
#undef main
#undef send
#undef pthread_create
#undef curl_easy_perform

static int attempts;
static int test_pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*fn)(void *), void *ctx) {
    if (++attempts % 2) return EAGAIN;
    return pthread_create(t, a, fn, ctx);
}
static CURLcode test_curl_easy_perform(CURL *c) { (void)c; return CURLE_COULDNT_CONNECT; }
static void count_job(void *ctx, int index) { ((int *)ctx)[index]++; }
static char response[8192];
static size_t response_len;
static ssize_t test_send(int fd, const void *data, size_t len, int flags) {
    (void)fd; (void)flags;
    assert(response_len + len < sizeof(response));
    memcpy(response + response_len, data, len);
    response_len += len;
    response[response_len] = 0;
    return (ssize_t)len;
}
static void check_request(const char *body, int status) {
    response_len = 0;
    handle_terrain(-1, body, "http://localhost:5173");
    char expected[32];
    snprintf(expected, sizeof(expected), "HTTP/1.1 %d", status);
    assert(strncmp(response, expected, strlen(expected)) == 0);
    assert(strstr(response, "Access-Control-Expose-Headers: X-Engine-Zoom"));
}

int main(void) {
    assert(curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK);
    fprintf(stderr, "Testing worker pool...\n");
    int counts[257] = {0};
    pool_run(8, 257, count_job, counts);
    for (int i = 0; i < 257; i++) assert(counts[i] == 1);
    memset(counts, 0, sizeof(counts));
    pool_run(1, 257, count_job, counts);
    for (int i = 0; i < 257; i++) assert(counts[i] == 1);
    fprintf(stderr, "Testing request validation...\n");
    check_request("{}", 400);
    check_request("{\"body\":\"mars\",\"lat\":0,\"lon\":0,\"sizeM\":1000,\"n\":65}", 400);
    check_request("{\"body\":\"earth\",\"lat\":0,\"lon\":0,\"sizeM\":300001,\"n\":65}", 400);
    check_request("{\"body\":\"moon\",\"lat\":0,\"lon\":0,\"sizeM\":120001,\"n\":65}", 400);
    check_request("{\"body\":\"mars\",\"lat\":0,\"lon\":0,\"sizeM\":120001,\"n\":65}", 400);
    check_request("{\"body\":\"mars\",\"lat\":0,\"lon\":0,\"sizeM\":20000,\"n\":770}", 400);
    check_request("{\"body\":\"mars\",\"lat\":85,\"lon\":0,\"sizeM\":20000,\"n\":65}", 400);
    check_request("{\"body\":\"earth\",\"lat\":NaN,\"lon\":0,\"sizeM\":1000,\"n\":65}", 400);
    check_request("{\"body\":\"earth\",\"lat\":0,\"lon\":0,\"sizeM\":1000,\"n\":65.5}", 400);
    fprintf(stderr, "Testing download failures...\n");
    /* Missing Earth tiles must fail instead of returning invented sea-level data. */
    check_request("{\"body\":\"earth\",\"lat\":45.8,\"lon\":6.8,\"sizeM\":1000,\"n\":65}", 502);
    /* Larger native sizes are accepted, reach the source, and report its failure. */
    check_request("{\"body\":\"earth\",\"lat\":0,\"lon\":0,\"sizeM\":300000,\"n\":65}", 502);
    /* Mars is accepted, tries every mosaic in turn, and reports failure rather than flat ground. */
    check_request("{\"body\":\"mars\",\"lat\":18.4,\"lon\":77.2,\"sizeM\":120000,\"n\":769}", 502);
    check_request("{\"body\":\"moon\",\"lat\":26.1,\"lon\":3.6,\"sizeM\":20000,\"n\":257}", 502);
    curl_global_cleanup();
    puts("Native regression tests passed (thread failures, validation, failed downloads, extended area, Mars).");
    return 0;
}
