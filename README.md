# NMCHV Tutor

Персональный кабинет образовательного развития (ученик / тьютор / администратор).
Стек: Node.js ≥ 22.5, Supabase (общая база данных PostgreSQL + Supabase Auth), ванильный ES-модульный фронтенд, дизайн-токены NMCHV.

## Переход на общую базу Supabase

Сервис больше не использует локальный SQLite в рабочем режиме. Все данные хранятся в общей базе NMCHV в Supabase, авторизация — через Supabase Auth (единый вход между сервисами NMCHV).

## Переменные окружения

Обязательные:
- `SUPABASE_URL` — URL проекта Supabase
- `SUPABASE_ANON_KEY` — anon-ключ проекта Supabase

Опциональные:
- `SUPABASE_SERVICE_ROLE_KEY` — service role ключ (только серверная сторона), нужен для создания пользователей и ролей администратором
- `PORT` — порт сервера (по умолчанию 3000)
- `APP_TZ` — часовой пояс (по умолчанию Europe/Moscow)

## Запуск

    npm install
    SUPABASE_URL=... SUPABASE_ANON_KEY=... npm start   # http://localhost:3000

Боевой режим (за HTTPS-прокси):
    SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... COOKIE_SECURE=1 PORT=3000 npm start

## Единый вход NMCHV (login.nmchv.ru)

Демонстрационный режим скрыт. На странице входа добавлена кнопка «Войти через login.nmchv.ru».

### Callback URL в Supabase Auth

В настройках Supabase Auth (Authentication → URL Configuration) нужно добавить redirect-URL обратного вызова tutora:

    https://<tutor-домен>/auth/callback

Например для продакшена:
    https://tutor.nmchv.ru/auth/callback

После успешного входа на `login.nmchv.ru` браузер перенаправляется на этот адрес с параметром `?token=<JWT>`. Сервис сохраняет токен в HttpOnly-cookie `sb-token` и возвращает пользователя в приложение.

## Схема базы данных

Файл `supabase/schema.sql` содержит все таблицы сервиса (с префиксом `tutor_` и общие `profiles`, `notifications`) и политики RLS. Применяется в общем Supabase-проекте NMCHV. Отдельная база данных не создаётся.

Пользователи и пароли хранятся только в `auth.users` (Supabase Auth). Идентификатор пользователя — UUID из `auth.users`, совпадающий с `profiles.id`.

## API

Все существующие маршруты `/api/...` сохранены. Операции с данными стали асинхронными (Supabase). Пользовательский JWT передаётся в заголовке `Authorization: Bearer <token>`. Права доступа проверяются на сервере и защищаются RLS-политиками.

## Старые данные

Локальный файл `data/nmchv-student.db` (SQLite) не удалён. Если там есть пользовательские данные, их можно экспортировать и перенести в новую структуру вручную до полного отказа от SQLite.

## Проверка

1. Авторизация через Supabase Auth (`/api/auth/login`, `/api/auth/register`, `/api/auth/logout`)
2. UUID пользователя из сессии (`/api/me`)
3. Роль пользователя (`tutor_user_roles`)
4. Профиль (`profiles`)
5. Цели (`tutor_educational_goals`)
6. Маршруты и этапы (`tutor_learning_routes`, `tutor_route_stages`)
7. Задачи (`tutor_tasks`)
8. Материалы (`tutor_resources`)
9. Комментарии (`tutor_task_comments`)
10. Уведомления (`notifications`)
11–14. Разграничение доступа и отсутствие зависимости от SQLite
