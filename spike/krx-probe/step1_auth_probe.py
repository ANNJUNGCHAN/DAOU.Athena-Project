"""
결정적 실험 1 — 401이 무엇을 뜻하는지 가려라
결정적 실험 2 — 호스트/경로가 유효한가

같은 KRX 엔드포인트에 (a) 실제 키 (b) 가짜 키 (c) 키 없음 세 조건으로 호출해
respMsg/respCode/HTTP상태가 달라지는지 비교한다.
"""
import json
import socket
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT / ".env"
CAPTURES = ROOT / "spike" / "captures"
CAPTURES.mkdir(parents=True, exist_ok=True)


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


env = load_env(ENV_PATH)
REAL_KEY = env["KRX_API_KEY"]
FAKE_KEY = "INVALID_TEST_KEY_12345"

ENDPOINTS = {
    "stk_isu_base_info": "http://data-dbg.krx.co.kr/svc/apis/sto/stk_isu_base_info",
    "stk_bydd_trd": "http://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd",
}

# stk_bydd_trd 는 basDd(기준일자) 파라미터가 필요한 것으로 문서상 알려짐. 없어도 오류 형태 비교엔 지장 없음.
PARAMS = {
    "stk_isu_base_info": {"basDd": "20260814"},
    "stk_bydd_trd": {"basDd": "20260814"},
}

results = {"experiment_1_auth_key_comparison": {}, "experiment_2_host_path_validity": {}}

# ---------- 실험 1: 키 값에 따른 응답 비교 ----------
for name, url in ENDPOINTS.items():
    results["experiment_1_auth_key_comparison"][name] = {}
    for label, key in [("real_key", REAL_KEY), ("fake_key", FAKE_KEY), ("no_key_header", None)]:
        headers = {}
        if key is not None:
            headers["AUTH_KEY"] = key
        try:
            r = requests.get(url, headers=headers, params=PARAMS[name], timeout=15)
            body_text = r.text
            try:
                body_json = r.json()
            except Exception:
                body_json = None
            results["experiment_1_auth_key_comparison"][name][label] = {
                "status_code": r.status_code,
                "headers_sent": headers,
                "response_headers": dict(r.headers),
                "body_text": body_text[:2000],
                "body_json": body_json,
            }
        except Exception as e:
            results["experiment_1_auth_key_comparison"][name][label] = {"exception": repr(e)}

# ---------- 실험 2: 호스트/경로 유효성 ----------
host = "data-dbg.krx.co.kr"
dns_result = {}
try:
    addrs = socket.getaddrinfo(host, None)
    dns_result["resolved"] = True
    dns_result["addresses"] = sorted({a[4][0] for a in addrs})
except Exception as e:
    dns_result["resolved"] = False
    dns_result["exception"] = repr(e)
results["experiment_2_host_path_validity"]["dns_data-dbg.krx.co.kr"] = dns_result

# 루트 경로 응답 (인증 없이)
for label, url in [
    ("root_data-dbg", "http://data-dbg.krx.co.kr/"),
    ("root_data-dbg_https", "https://data-dbg.krx.co.kr/"),
    ("svc_root_no_auth", "http://data-dbg.krx.co.kr/svc/apis/sto/stk_isu_base_info"),
]:
    try:
        r = requests.get(url, timeout=15, allow_redirects=True)
        results["experiment_2_host_path_validity"][label] = {
            "status_code": r.status_code,
            "final_url": r.url,
            "body_text_head": r.text[:1000],
        }
    except Exception as e:
        results["experiment_2_host_path_validity"][label] = {"exception": repr(e)}

# 대안 호스트 openapi.krx.co.kr 에 같은 경로가 있는지
for label, url in [
    ("openapi_krx_same_path_http", "http://openapi.krx.co.kr/svc/apis/sto/stk_isu_base_info"),
    ("openapi_krx_same_path_https", "https://openapi.krx.co.kr/svc/apis/sto/stk_isu_base_info"),
    ("openapi_krx_root", "https://openapi.krx.co.kr/"),
]:
    try:
        r = requests.get(url, headers={"AUTH_KEY": REAL_KEY}, params={"basDd": "20260814"}, timeout=15, allow_redirects=True)
        results["experiment_2_host_path_validity"][label] = {
            "status_code": r.status_code,
            "final_url": r.url,
            "body_text_head": r.text[:1000],
        }
    except Exception as e:
        results["experiment_2_host_path_validity"][label] = {"exception": repr(e)}

out_path = CAPTURES / "KRX-auth-host-probe.json"
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"WROTE {out_path}")
