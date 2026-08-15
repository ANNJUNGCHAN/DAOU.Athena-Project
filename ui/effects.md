# Paper Shaders — Athena 효과 선별

출처: [shaders.paper.design](https://shaders.paper.design/) · [github.com/paper-design/shaders](https://github.com/paper-design/shaders)
패키지: `@paper-design/shaders-react` (Apache 2.0). 0.0.x 버저닝이라 **breaking change 잦음 — 버전 고정 필수.**

전체 셰이더 30종 확인. 아래는 Athena에 실제로 쓸 것만 추린 목록이다.
YC 절차상 이 단계도 **선별**이다. 다 쓰지 않는다.

---

## 채택

### 1. PulsingBorder → 커맨드바 포커스 링
Athena의 유일한 입력 지점에 정확히 대응하는 전용 셰이더. 테두리만 렌더링해 픽셀 수가 적고, **포커스 시에만 마운트**하면 상시 부하 없음.

주요 파라미터: `colors[]`(최대 5), `roundness`, `thickness`, `margin*`, `softness`, `intensity`, `bloom`, `spots`, `spotSize`, `pulse`, `smoke`

> soul.md §4 — "화면에 채도 높은 색이 있다면, 그것은 지금 이걸 봐야 한다는 뜻이다." 포커스 링은 그 조건을 만족하는 몇 안 되는 자리다.

### 2. GrainGradient (`shape: sphere`) → 부팅 게이지
"게이지가 쭉 차면서 창 하나만 딱 뜬다" — 제품 첫인상을 만드는 3초.

주요 파라미터: `colorBack`, `colors[]`(최대 7), `softness`, `intensity`, `noise`, `shape`(wave/dots/truchet/corners/ripple/blob/sphere)

작은 컴포넌트 크기라 상시 렌더링해도 부담 없음.

### 3. GodRays → 온보딩 (CLI 연결)
일회성 노출. 성능보다 임팩트 우선으로 써도 되는 유일한 자리.

주요 파라미터: `colorBack`, `colorBloom`, `colors[]`(최대 5), `spotty`, `midSize`, `midIntensity`, `density`, `intensity`, `bloom`

---

## 조건부 — 최종 시안이 다크로 확정될 때만

### MeshGradient / StaticMeshGradient → 배경 앰비언스
`distortion` + `swirl`로 유기적 리퀴드, `grainMixer`/`grainOverlay`로 필름 그레인.

**전면 상시 렌더링이므로 규율 필요:**
- `maxPixelCount`로 4K에서 렌더 해상도 캡 — 필수
- 창 비활성/최소화 시 `speed=0` 또는 언마운트 (`document.visibilitychange`로 직접 제어)
- 정적 상태에서는 `StaticMeshGradient`로 스왑

라운드 1의 D안(바우하우스 라이트)이 이기면 **이 항목 전체 폐기.**

---

## 보류

**LiquidMetal** — 이름은 맞지만 시선을 너무 끈다. 브랜드 마크 전용으로만 검토. 배경 금지.
**Dithering** — 영상에서 언급된 효과지만 금융 숫자 가독성과 충돌. 데이터 영역에는 절대 쓰지 않는다.

---

## 절대 금지

**차트/숫자 위에 셰이더를 얹지 않는다.**
soul.md §7 — "의미 없는 글로우·네온 테두리 — 빛은 데이터가 있는 곳에만."
셰이더는 데이터가 *없는* 곳에서만 산다. 배경, 테두리, 로딩, 온보딩. 그 넷이 전부다.

---

## 사용 예

```bash
npm i @paper-design/shaders-react
```

```jsx
import { MeshGradient, DotOrbit } from '@paper-design/shaders-react'

<MeshGradient
  colors={['#5100ff', '#00ff80', '#ffcc00', '#ea00ff']}
  distortion={1}
  swirl={0.8}
  speed={0.2}
  style={{ width: 200, height: 200 }}
/>
```

공통 파라미터: `fit`, `scale`, `rotation`, `origin*`, `offset*`, `worldWidth/Height` · `speed`, `frame`, `maxPixelCount`, `minPixelRatio`

미검증: Electron 등 데스크톱 셸에서 동시 WebGL 컨텍스트 상한 — 셰이더를 4개 이상 동시 마운트하기 전에 실측 필요.
