// つなぐ の render.mjs を、この環境に入っている Chromium で動かすための前読み込み（node --require で使う）
const pw = require(require.resolve('playwright', { paths: [process.cwd(), __dirname] }));
const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = (opts = {}) => launch({ executablePath: exe, ...opts });
