# 마자용

소상공인을 위한 웹 외주 요구사항 정의 · 매칭 플랫폼 — 화면 구현.

```bash
npm install
npm run build
npm start          # http://localhost:3000  · 전체 화면 목록: /screens
```

## 구조

- `web/templates/<Screen>.html` — 화면 마크업과 화면 전용 스타일(`<helmet>`).
  템플릿 문법: `{{ path }}`, `<sc-if value="{{ x }}">`, `<sc-for list="{{ xs }}" as="x">`,
  `onClick="{{ handler }}"`.
- `src/screens/<Screen>.ts` — 화면의 뷰 모델(`renderVals()`)과 상태 레버(`props`).
- `src/lib/` — 템플릿 렌더러(`template.ts`), `Screen` 기반 클래스(`screen.ts`),
  페이지 레이아웃(`page.ts`), 화면 목록(`catalog.ts`).
- `web/assets/app.css` — 공용 디자인 시스템 스타일(v0.2), `web/assets/fonts/` — Pretendard Variable.

라우트는 화면 이름 그대로입니다(`/Home-Client`, `/Admin-Events`, `/`는 의뢰인 랜딩).
화면 상태는 쿼리로 고릅니다: `/Account-Client?view=탈퇴 확인`. `/screens`에 모든 화면과 상태가 있습니다.

`npm run snapshot -- <dir>`는 모든 화면 · 상태를 HTML로 렌더링해 리팩터링 전후 비교에 씁니다.
