# 우리의 할 일 — 공유 투두리스트

이 링크에 들어온 모든 사람이 같은 목록을 보고 함께 고치는 투두리스트예요.
Vercel(호스팅)과 Upstash Redis(저장소)의 무료 플랜만으로 돌아가요.

```
todo-app/
├─ index.html      화면 (5초마다 서버와 동기화)
├─ api/todos.js    목록을 읽고 쓰는 서버 함수
└─ package.json    외부 라이브러리 없음
```

## 배포 방법 (GitHub 사용, 약 10분)

1. **GitHub에 올리기**
   - https://github.com/new 에서 새 저장소를 만드세요 (예: `shared-todo`).
   - 저장소 페이지의 **uploading an existing file**을 눌러 이 폴더 안의 파일(`index.html`, `package.json`, `api` 폴더, `.gitignore`)을 끌어다 놓고 **Commit changes**를 누르세요.

2. **Vercel에 연결하기**
   - https://vercel.com 에 GitHub 계정으로 가입하세요 (Hobby 플랜, 무료).
   - **Add New… → Project**에서 방금 만든 저장소를 **Import**하세요.
   - 설정은 그대로 두고 **Deploy**를 누르세요. Framework Preset은 `Other`면 돼요.
   - 이 시점에 사이트를 열면 "저장소가 연결되지 않았어요"라고 나와요. 정상이에요.

3. **저장소(Redis) 붙이기**
   - Vercel 프로젝트 화면에서 **Storage** 탭으로 가서 **Upstash → Redis(Upstash for Redis)**를 고르고, **Free** 플랜으로 새 데이터베이스를 만드세요. 지역은 가까운 곳(예: Tokyo `ap-northeast-1`)을 고르세요.
   - 이 프로젝트에 연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 환경변수가 자동으로 추가돼요.

4. **다시 배포하기**
   - **Deployments** 탭에서 가장 최근 배포의 **⋯ → Redeploy**를 누르세요. 환경변수는 새로 배포할 때부터 적용돼요.
   - 끝나면 `https://프로젝트이름.vercel.app` 주소를 친구들에게 공유하면 돼요.

이후에는 GitHub의 파일을 고칠 때마다 Vercel이 자동으로 다시 배포해요.

## 터미널로 배포하고 싶다면

```bash
npm i -g vercel
cd todo-app
vercel          # 로그인하고 질문에 Enter로 답하기
# Vercel 웹에서 3번(Storage 연결)을 한 뒤
vercel --prod
```

## 알아둘 점

- **링크를 아는 사람은 누구나** 추가·수정·삭제할 수 있어요. 로그인이나 비밀번호는 없어요.
- 다른 사람의 변경은 최대 5초 뒤에 화면에 나타나요.
- 할 일은 최대 500개까지 저장돼요 (`api/todos.js`의 `MAX_ITEMS`에서 바꿀 수 있어요).
- 무료 플랜 한도는 소규모로 쓰기엔 충분해요. 정확한 한도는 Vercel과 Upstash 요금 페이지에서 확인하세요.
