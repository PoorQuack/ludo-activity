#!/usr/bin/env bash
# like serve.sh, but the page exposes window.__dbg() for tests
L=dbg; R="$HOME/mnt/ludo-activity"; W=/tmp/prev-$L
[ -f /tmp/pw/sp ] && kill $(cat /tmp/pw/sp) 2>/dev/null; sleep 0.5
rm -rf $W; mkdir -p $W
(cd "$R" && tar --exclude=./node_modules --exclude=./dist --exclude=./data --exclude=./.git --exclude=./.env --exclude=./.shots -cf - .) | tar -xf - -C $W
sed -i 's/^function myTheme() {$/function myTheme() {\n  if (window.__theme) return window.__theme;/' $W/client/main.js
printf '\nwindow.__r = renderer;\nwindow.__dbg = () => ({ pin: (() => { const it = canMove() && renderer.lastLayout?.find((i) => i.seat === playSeat() && state.movable.includes(i.token)); return it ? renderer.tokenPoint(it) : null; })(), idle: idle(), myGo: myGo(), dice: { ...dice }, cur: current && { predicted: current.predicted, type: current.type, el: current.elapsed, moveMs: current.moveMs }, shown: shownTokens, latest: latestTokens, events: events.length, state });\n' >> $W/client/main.js
python3 - "$W/server/room.js" <<'PY'
import sys
p=sys.argv[1]; s=open(p,newline='').read()
k='    this.addLog(`Game started! ${this.seats[this.turn].name} goes first.`);'
assert k in s
s=s.replace(k, k+'\n    if (process.env.FORCE_DECIDER && this.teams) { this.winners = [0, 1, 3]; this.endIfOver(); return; }')
open(p,'w',newline='').write(s)
PY
ln -s /tmp/dep/work/node_modules $W/node_modules; mkdir -p $W/data
cd $W && npx vite build > $W/build.log 2>&1 || { echo BUILD FAILED; tail -20 $W/build.log; exit 1; }
(PORT=3990 DATA_FILE=$W/data/p.json ALLOW_GUESTS=true FORCE_DECIDER=${FORCE_DECIDER:-} node server/index.js > $W/server.log 2>&1 & echo $! > /tmp/pw/sp)
for i in $(seq 1 40); do curl -s localhost:3990/healthz >/dev/null 2>&1 && break; sleep 0.5; done
echo served
