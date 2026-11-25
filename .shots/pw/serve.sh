#!/usr/bin/env bash
# serve.sh <label>: copy the project, build it, start it on :3990 (pid in /tmp/pw/sp)
L="$1"; R="$HOME/mnt/ludo-activity"; W=/tmp/prev-$L
[ -f /tmp/pw/sp ] && kill $(cat /tmp/pw/sp) 2>/dev/null; sleep 0.5
rm -rf $W; mkdir -p $W
(cd "$R" && tar --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.git --exclude=./.env --exclude=./.shots -cf - .) | tar -xf - -C $W
ln -s /tmp/dep/work/node_modules $W/node_modules
mkdir -p $W/data
cd $W && npx vite build > $W/build.log 2>&1 || { echo BUILD FAILED; tail -20 $W/build.log; exit 1; }
(PORT=3990 DATA_FILE=$W/data/p.json ALLOW_GUESTS=true FREE_SHOP=${FREE_SHOP:-false} node server/index.js > $W/server.log 2>&1 & echo $! > /tmp/pw/sp)
for i in $(seq 1 40); do curl -s localhost:3990/healthz >/dev/null 2>&1 && break; sleep 0.5; done
echo served
