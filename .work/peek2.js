const fs = require('fs');
const p = 'E:/share/SillyTavern/data/default-user/settings.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = JSON.stringify(j);
for (const k of ['allow_streaming', 'use_blob_url', 'TH-render', 'tavern_helper', 'depth_ignore_hidden']) {
  const i = s.indexOf(k);
  console.log(k + ' -> ' + (i === -1 ? 'not found' : s.slice(i - 80, i + 160)));
}
console.log('streaming_fps =', j.power_user && j.power_user.streaming_fps);
