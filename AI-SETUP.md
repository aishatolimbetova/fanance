# ИИ-помощник (вкладка «Поддержка»)

**Gemini:** добавьте переменную окружения `GEMINI_API_KEY` (Vercel → Settings → Environment Variables → Redeploy; локально: `GEMINI_API_KEY=... node server.js`). Если она задана, используется Gemini (модель по умолчанию `gemini-2.5-flash`, меняется через `GEMINI_MODEL`); иначе — `ANTHROPIC_API_KEY`. Ключ хранится только на сервере, в браузерный код его класть нельзя.

## Vercel (самый простой путь)
1. Загрузите эту папку проекта целиком (вместе с `api/`, `vercel.json`, `ai.js`) в тот репозиторий/проект, который подключён к Vercel, и сделайте деплой.
2. Vercel → ваш проект → Settings → Environment Variables → добавьте `ANTHROPIC_API_KEY` = ваш ключ с console.anthropic.com (тип Production).
3. Сделайте Redeploy (переменные подхватываются только новым деплоем).
4. Откройте сайт, войдите в аккаунт и задайте вопрос в «Поддержке».

Если чат пишет «не задан ключ» — шаг 2–3 не сделан. Если «не запущен /api/ai» — папка `api/` не попала в деплой.


Ключ Anthropic API **никогда не кладётся в браузерный код** — запросы идут через прокси.

## Вариант 1. Свой сервер (server.js)
```
ANTHROPIC_API_KEY=sk-ant-... node server.js
```
Необязательно: `AI_MODEL` (по умолчанию `claude-sonnet-5-5`), `AI_PER_MIN` (запросов в минуту на пользователя, по умолчанию 12).
Адрес и ключ Supabase для проверки входа берутся из `public/config.js` (или `SUPABASE_URL` / `SUPABASE_KEY`).

## Вариант 2. Статический хостинг (Netlify, Vercel, GitHub Pages) + Supabase Edge Function
```
supabase functions deploy ai
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```
В `public/config.js`: `ai: { url: "https://<проект>.supabase.co/functions/v1/ai" }`

## Как это работает
- Вопрос пользователя уходит в `/api/ai` вместе с последними сообщениями и короткой сводкой финансов за текущий месяц.
- Без входа в аккаунт прокси отвечает 401; ключа нет — 503. В обоих случаях чат отвечает по встроенной базе подсказок.
- Системная инструкция хранится на сервере (`ai.js`, `supabase/functions/ai/index.ts`) — если меняете её, правьте оба файла.

Для ещё более сильных ответов поставьте `AI_MODEL=claude-opus-5-5` (дороже и медленнее); для самых дешёвых — `claude-haiku-5-5`.
