#!/usr/bin/env bash
R="$HOME/mnt/ludo-activity"; W=/tmp/prev-dev
[ -f /tmp/pw/dsp ] && kill $(cat /tmp/pw/dsp) 2>/dev/null; sleep 0.5
rm -rf $W; mkdir -p $W
(cd "$R" && tar --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.git --exclude=./.env --exclude=./.shots -cf - .) | tar -xf - -C $W
ln -s /tmp/dep/work/node_modules $W/node_modules
cp /tmp/pw/gal/* $W/client/
cd $W && (npx vite --port 3991 --strictPort > $W/dev.log 2>&1 & echo $! > /tmp/pw/dsp)
for i in $(seq 1 60); do curl -s localhost:3991/gallery.html >/dev/null 2>&1 && break; sleep 0.5; done
echo dev up
