CC ?= cc
CFLAGS ?= -O3 -march=x86-64-v3 -mtune=native -flto -pthread -Wall -Wextra -Wno-unused-parameter
LDLIBS = -lcurl -lpng -lz -lm -lpthread

relay-engine: relay-engine.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

.PHONY: clean run
clean:
	rm -f relay-engine test-engine

run: relay-engine
	./relay-engine

# User-local installation; no sudo needed.
PREFIX ?= $(HOME)/.local
.PHONY: install portable test
install: relay-engine
	install -Dm755 relay-engine $(DESTDIR)$(PREFIX)/bin/relay-engine

portable:
	$(CC) -O3 -march=x86-64 -mtune=generic -pthread -Wall -Wextra -Wno-unused-parameter -o relay-engine relay-engine.c $(LDLIBS)

test: test-engine
	./test-engine

test-engine: test-engine.c relay-engine.c
	$(CC) -O1 -g -pthread -Wall -Wextra -Wno-unused-parameter -o $@ $< $(LDLIBS)
