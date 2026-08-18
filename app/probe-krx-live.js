// 장중 KRX 차단 진단 — `datasets/장중_해야할것_QA.md` §2의 0순위 판별을 수행한다.
//
// 왜 Electron으로 도는가: KRX_API_KEY는 safeStorage(DPAPI)로 암호화돼 레지스트리에
// 센티널만 남아 있다. 복호화는 Electron 프로세스에서만 가능하므로(`lib/main/secrets.js`),
// 앱이 upstream을 spawn할 때와 **동일한 경로**로 키를 얻어 KRX에 직접 묻는다.
//
// 무엇을 가리는가: `spike/krx-probe/RESULT.md`가 이미 "실제 키 → Unauthorized API Call /
// 가짜 키 → Unauthorized Key"라는 구분을 관측해 '활용신청 미승인'으로 판정했다. 다만 그
// 실험의 실행 시각이 장중이었는지 기록이 없다. 이 스크립트는 **정규장 시간에 같은 실험을
// 재현**해서, 차단이 승인 문제인지 시간대 정책인지를 가른다.
//
// 실행: cd app && npx electron probe-krx-live.js
// 산출: datasets/eval-runs/<날짜>-intraday/krx-probe.json (실키는 기록하지 않는다)

process.env.ATHENA_NO_AUTOSTART = '1';

const { app, safeStorage } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 이 스크립트를 `electron probe-krx-live.js`로 직접 실행하면 앱 이름이 기본값(Electron)이
// 되어 userData가 앱 본체와 갈린다 — 그러면 `athena-secrets.json`을 못 찾아 키 복호화가
// 조용히 실패한다(첫 실행에서 실제로 겪었다). 앱과 같은 userData를 명시적으로 못박는다.
app.setPath('userData', path.join(app.getPath('appData'), 'athena-shell'));

// http로 부르면 302로 https에 튕긴다(첫 실행 실측). 스파이크의 python `requests`는
// 리다이렉트를 자동으로 따라가서 이 차이가 드러나지 않았다 — 여기선 https로 직접 간다.
const ENDPOINTS = {
  stk_isu_base_info: 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_isu_base_info',
  stk_bydd_trd: 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd',
};
const FAKE_KEY = 'INVALID_TEST_KEY_12345';

// 조회 기준일. 장중 재현이 목적이므로 "직전 거래일"을 쓴다 — 당일 데이터는 장중에
// 아직 확정되지 않아 미승인과 무관하게 빈 응답이 날 수 있고, 그러면 판정이 흐려진다.
function prevBusinessDay(now) {
  const d = new Date(now);
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function get(url, authKey, params) {
  return new Promise((resolve) => {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const headers = {};
    if (authKey != null) headers.AUTH_KEY = authKey;
    const req = https.get(u, { headers, timeout: 20000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* 본문이 JSON이 아닐 수 있다 */ }
        resolve({
          status_code: res.statusCode,
          content_length: res.headers['content-length'] || null,
          body_text: body.slice(0, 1000),
          body_json: json,
        });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: String(e && e.message) }));
  });
}

function marketSession(d) {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return '휴장(주말)';
  const m = d.getHours() * 60 + d.getMinutes();
  if (m < 8 * 60 + 30) return '장 시작 전';
  if (m < 9 * 60) return '장 시작 동시호가';
  if (m <= 15 * 60 + 30) return '정규장';
  if (m < 16 * 60) return '장 마감 직후';
  if (m <= 18 * 60) return '시간외 단일가';
  return '장 마감 후';
}

app.whenReady().then(async () => {
  const started = new Date();
  const out = {
    purpose: '장중_해야할것_QA.md §2 — KRX 차단이 승인 문제인지 시간대 문제인지 판별',
    ran_at_local: started.toISOString(),
    ran_at_kst_wall: started.toString(),
    market_session: marketSession(started),
    encryption_available: safeStorage.isEncryptionAvailable(),
    user_data_path: app.getPath('userData'),
    secrets_store_exists: fs.existsSync(path.join(app.getPath('userData'), 'athena-secrets.json')),
    basDd: prevBusinessDay(started),
    experiments: {},
  };

  let realKey = null;
  try {
    const { buildEnvOverrides, envVarName } = require('./lib/main/mcp-env');
    const overrides = buildEnvOverrides('korea-stock-mcp');
    realKey = overrides[envVarName('korea-stock-mcp', 'KRX_API_KEY')] || null;
    out.key_resolved = realKey != null;
    out.key_char_count = realKey ? realKey.length : 0; // 값은 남기지 않는다. 길이만.
  } catch (e) {
    out.key_resolved = false;
    out.key_error = String(e && e.message);
  }

  for (const [name, url] of Object.entries(ENDPOINTS)) {
    out.experiments[name] = {};
    const conditions = [
      ['real_key', realKey],
      ['fake_key', FAKE_KEY],
      ['no_key_header', null],
    ];
    for (const [label, key] of conditions) {
      if (label === 'real_key' && key == null) {
        out.experiments[name][label] = { skipped: '키 복호화 실패' };
        continue;
      }
      out.experiments[name][label] = await get(url, key, { basDd: out.basDd });
    }
  }

  // 판정: 실제 키와 가짜 키의 응답이 다르면 "키는 유효하나 이 API 권한이 없다"(미승인),
  // 같으면 키 자체가 인식되지 않는 것이고, 200이면 차단이 풀린 것이다.
  const verdicts = {};
  for (const [name, exp] of Object.entries(out.experiments)) {
    const real = exp.real_key || {};
    const fake = exp.fake_key || {};
    const realMsg = real.body_json && (real.body_json.respMsg || real.body_json.message);
    const fakeMsg = fake.body_json && (fake.body_json.respMsg || fake.body_json.message);
    let verdict;
    if (real.status_code === 200) verdict = 'KRX 열림 — 차단 해소됨(시세 케이스 재평가 필요)';
    else if (realMsg && fakeMsg && realMsg !== fakeMsg) verdict = '미승인 — 키는 유효, 이 API 호출 권한 없음(시각 무관)';
    else if (realMsg && fakeMsg && realMsg === fakeMsg) verdict = '키 미인식 — 등록된 키가 서버에 없거나 형식 불일치';
    else verdict = '판정 불가 — 원문 확인 필요';
    verdicts[name] = { verdict, real_msg: realMsg || null, fake_msg: fakeMsg || null, real_status: real.status_code || null };
  }
  out.verdicts = verdicts;

  const stamp = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`;
  const dir = path.join(__dirname, '..', 'datasets', 'eval-runs', `${stamp}-intraday`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'krx-probe.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');
  // 콘솔은 cp949라 한글이 깨진다(CLAUDE.md §8). 판정은 파일을 열어 확인한다.
  process.stdout.write(`WROTE ${file}\n`);
  app.exit(0);
});
