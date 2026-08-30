# План добавления платформ публикации

Статус проверки: 29 августа 2026 года.

## Цель и границы

Добавить отдельные пакеты-адаптеры для Facebook, Threads, Instagram, YouTube, TikTok, X и
Pinterest. Адаптеры используют только Web APIs (`fetch`, `Request`, `Response`, WHATWG streams,
Web Crypto) и прямые HTTP-запросы. SDK поставщиков и runtime-зависимости запрещены.

В этой итерации поддерживаются только:

- создание публикации;
- асинхронное ожидание обработки через `checkStatus()` там, где оно обязательно;
- возобновляемая загрузка больших файлов;
- загрузка видео на YouTube (результат может оставаться в `processing`; публикация считается
  созданной после успешного `videos.insert`).

Не входят в эту итерацию: редактирование, удаление, аналитика, чтение лент, комментарии,
модерация и собственный планировщик. Новые адаптеры не реализуют `delete()`. Поле
`scheduledAt` отвергается, если конкретный официальный publish endpoint не поддерживает его
как часть создания. Существующее удаление Telegram не расширяется и не является образцом для
новых пакетов.

## Что означает «всё, что поддерживает BloggerDog»

В `../bloggerdog` найдены типы `POST`, `ARTICLE`, `NEWS`, `VIDEO`, `SHORT`, `STORY` и медиа
`IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`. `ARTICLE` и `NEWS` — продуктовые формы контента, а не
самостоятельные форматы большинства соцсетей. Для внешней сети они публикуются как обычный
пост с подходящими текстом и медиа. Нельзя молча превращать неподдерживаемый тип в другой:
адаптер возвращает структурированную ошибку/предупреждение, а явное отображение выполняется
до вызова адаптера.

Требуемое отображение:

| BloggerDog                         | Библиотечный тип/режим              | Назначение                                 |
| ---------------------------------- | ----------------------------------- | ------------------------------------------ |
| `POST`, `NEWS`, короткий `ARTICLE` | `post`, `image` или `album`         | текст, одна картинка, галерея              |
| длинный `ARTICLE`                  | обычный пост в пределах лимита      | сеть не получает фиктивную «статью»        |
| `VIDEO`                            | `video`, `extra.videoKind = "long"` | обычное горизонтальное видео               |
| `SHORT`                            | новый явный тип `shortVideo`        | Reel, Short или TikTok video               |
| `STORY`                            | `story`                             | только сети с официальным endpoint Stories |

Ориентация сама по себе недостаточна для выбора формата: вертикальное видео может быть Reel,
обычным видео или Story. `SHORT`/`STORY` должны приходить явно. Для `POST` сохраняется
автоопределение `post`/`image`/`album` по медиа.

## Матрица первой версии

`Да` означает отдельный официальный create-flow. `Как пост` означает продуктовый тип
BloggerDog, преобразованный до адаптера. `Нет` означает локальный отказ до сетевого запроса.

| Платформа              | Текст | 1 фото | Галерея               | SHORT                                  | VIDEO             | STORY                                    | ARTICLE/NEWS                                 |
| ---------------------- | ----- | ------ | --------------------- | -------------------------------------- | ----------------- | ---------------------------------------- | -------------------------------------------- |
| Facebook Page          | Да    | Да     | Да                    | Reels                                  | Да                | проверить Page Stories перед реализацией | Как пост                                     |
| Threads                | Да    | Да     | carousel              | видео-пост, не отдельный формат        | Да                | Нет                                      | Как пост                                     |
| Instagram professional | Нет   | Да     | carousel              | Reel                                   | Reel/видео        | Да                                       | Как caption + media                          |
| YouTube                | Нет   | Нет    | Нет                   | `videos.insert`, классификация YouTube | `videos.insert`   | Нет                                      | metadata видео                               |
| TikTok                 | Нет   | Да     | photo post            | video direct post                      | video direct post | Нет                                      | caption/description + media                  |
| X                      | Да    | Да     | до 4 изображений      | video post                             | video post        | Нет                                      | Как post/thread только при отдельном решении |
| Pinterest              | Нет   | Да     | Нет в organic Pins v5 | video Pin                              | video Pin         | Нет                                      | title/description + media                    |

Важно: смешанная коллекция изображений и видео поддерживается не везде. Она не должна
объявляться как общий `album`, пока правила конкретной сети не подтверждены. TikTok photo post
— коллекция только изображений; X — либо до четырёх изображений, либо одно видео/GIF;
Pinterest v5 создаёт один image/video Pin, а не органическую карусель.

## Готовность текущей архитектуры

### Уже готово

- отдельные workspace-пакеты и scaffold для платформ;
- нулевые runtime-зависимости и проверка `pnpm check:deps`;
- URL, bytes, Blob, повторно открываемый stream и platform reference как источники медиа;
- общий HTTP transport, `AbortSignal`, нормализация ошибок и `retry_after`;
- OAuth 2 token refresh и внешний `CredentialProvider`;
- `runChunkedUpload()`, `ResumeHandle`, `processing` и `checkStatus()`;
- декларативные capabilities, preview и conformance suite;
- сервер допускает регистрацию массива модулей платформ.

### Блокирующие изменения ядра до адаптеров

1. Добавить явный `PostType.SHORT_VIDEO`. Текущее расширяемое строковое объединение позволяет
   передать неизвестную строку, но `detectPostType()`, каталог, preview и conformance не имеют
   общей семантики SHORT. Старый алиас не оставлять.
2. Разделить «тип публикации» и «набор вложений». Сейчас `ALBUM` определяется при двух любых
   медиа, хотя допустимость смешанного набора платформозависима. Нужны точные `mediaCounts` и
   platform validation hooks.
3. Добавить декларативные видео-ограничения: aspect ratio/width/height, duration, codec/container,
   frame rate и требование cover. Сейчас часть из них можно проверить только вручную в адаптере.
4. Уточнить модель асинхронного результата. Meta containers, TikTok, X video processing,
   Pinterest video и YouTube требуют polling. `checkStatus()` подходит, но handle должен хранить
   только JSON-состояние, без access token и подписанного upload URL в логах/raw.
5. Добавить безопасный helper для multipart/form-data и single/multipart upload на Web APIs.
   `runChunkedUpload()` покрывает offset-based протоколы, но не все init/finalize/status варианты.
6. Не считать generic retry публикации безопасным. Повторять можно только адресованный chunk или
   status call. После неопределённого ответа create/publish нужна платформа-специфичная проверка;
   иначе возможны дубликаты.
7. OAuth различается: Meta long-lived token exchange, Threads refresh, Google refresh token,
   TikTok rotation, X OAuth 2 PKCE/OAuth 1.0a и Pinterest refresh нельзя выразить одним статическим
   token endpoint без platform config. Authorization flow остаётся у host, но документировать
   обязательные scopes, target IDs и refresh strategy необходимо для каждого пакета.
8. HTTP shell с JSON/base64 и общим body limit не годится для больших видео. Для Node/Workers
   нужны URL/stream source либо отдельный streaming ingress; нельзя материализовать YouTube/TikTok
   видео в JSON или памяти Worker.
9. Каталог — только предварительная справка. Перед реализацией исправить в нём неподтверждённые
   значения: generic media sources у Facebook/Pinterest, YouTube MIME как только
   `application/octet-stream`, TikTok `ALBUM` из 1 элемента, а также отсутствие различия
   Reel/Story/обычного video.
10. В конфигурации нужны platform-specific target: Facebook Page ID, Meta/Threads/Instagram user
    ID, YouTube channel из токена, TikTok open ID/creator context, Pinterest board ID. Одного
    неструктурированного `target` достаточно для wire contract, но README каждого адаптера должен
    задать точное значение.

## Платформенные планы

### Facebook Pages

Охват: только публикация на Page, не личный профиль и не Group. Нужен Page access token и
разрешения, действующие для выбранной версии Graph API (как минимум проверить
`pages_manage_posts` и `pages_read_engagement` при реализации).

Flow:

1. текст/ссылка: `POST /{page-id}/feed`;
2. одно фото: `POST /{page-id}/photos`;
3. галерея: создать фото с `published=false`, затем создать feed post с `attached_media`;
4. обычное видео: официальный resumable Video API flow;
5. Reel: start/upload/finish для Page Reels и polling статуса;
6. Story добавлять только после отдельного подтверждения актуального Page Stories create endpoint,
   прав и форматов. До этого `STORY` должен быть `unsupported`.

Проблемы: Graph API version нужно фиксировать одной константой и обновлять осознанно; Page и
Instagram используют разные IDs/permissions; создание нескольких unpublished photo создаёт
частичные артефакты при сбое, поэтому `PostPart` и resume state обязательны. Публичные URL не
следует объявлять универсальным способом для видео, пока это не подтверждено endpoint-ом.

Официальные источники: [Pages API: Posts](https://developers.facebook.com/docs/pages-api/posts/),
[Page feed reference](https://developers.facebook.com/docs/graph-api/reference/page/feed/),
[Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/),
[Video publishing](https://developers.facebook.com/docs/video-api/guides/publishing/),
[Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing/).

### Threads

Поддержать text, image, video и carousel через двухшаговую модель: создать container
`POST /{threads-user-id}/threads`, дождаться готовности медиа при необходимости, затем
`POST /{threads-user-id}/threads_publish`. Для carousel сначала создаются дочерние containers,
затем container с `media_type=CAROUSEL`. Медиа забирается Meta по публичному URL, поэтому
`bytes/blob/stream` требуют временного публичного object storage на стороне host и не должны
объявляться адаптером как прямые источники.

SHORT не является отдельным API-типом Threads: вертикальное видео публикуется как video post.
Story отсутствует. Поддержать text attachment/link только если он описан текущей версией API.

Проблемы: permissions и доступность полей меняются с версией API; container ID ещё не означает
публичный post; нужны status polling, container expiry и защита от повторного publish.

Официальные источники: [Threads publishing](https://developers.facebook.com/docs/threads/posts/),
[Threads API overview](https://developers.facebook.com/docs/threads/).

### Instagram

Охват: только поддерживаемые API professional accounts; личные consumer accounts не обещать.
Текст без медиа невозможен. Создать media container, дождаться `FINISHED`, затем вызвать
`/{ig-user-id}/media_publish`. Поддержать single image, Reel/video, carousel и Story только в
точном составе, разрешённом Content Publishing API. Для carousel создавать child containers.

Для media URL требуется публичная доступность без интерактивной авторизации. Изображения должны
соответствовать формату, который прямо допускает API (не расширять каталог generic image MIME).
Для Reel/Story нужны отдельные validation rules, а не эвристика по ориентации.

Проблемы: account eligibility и permissions; лимит публикаций проверять через официальный quota
endpoint, а не только статическую константу; container expiry; асинхронная обработка; требования
к aspect ratio/duration/codecs; carousel не равен Story; caption/hashtag limits могут изменяться.

Официальные источники:
[Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/),
[Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/),
[IG media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/).

### YouTube

Реализовать прямой HTTP resumable upload: инициировать
`POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable`, сохранить
`Location`, затем передавать bytes через `PUT` с `Content-Range`. Размер chunk кратен 256 KiB,
кроме последнего. При неопределённом результате запросить позицию пустым `PUT` с
`Content-Range: bytes */TOTAL`. Возвращать `processing` и проверять `processingDetails` через
`videos.list`.

`VIDEO` и `SHORT_VIDEO` используют один `videos.insert`. Нельзя обещать отдельный Shorts endpoint:
YouTube классифицирует Short по актуальным правилам самого продукта. Валидация SHORT должна
проверять действующие duration/aspect правила, но итоговая классификация остаётся за YouTube.
Обязательны title, privacy status и categoryId (category можно дать platform default в account
config). Description/tags/language/thumbnail поддержать как metadata и отдельный thumbnails flow.

«Предзагрузка» в рамках библиотеки означает успешно созданное видео с выбранной видимостью,
обычно `private`, которое ещё обрабатывается. Это не локальный draft и не отменяет quota cost.

Проблемы: проекты с непроверенным OAuth consent screen загружают видео только private; upload
имеет высокий quota cost; максимальный размер/длительность зависит также от верификации канала;
Workers имеют лимиты длительности запроса и размера тела; session URI чувствителен и не должен
попадать в raw/log.

Официальные источники: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
[resumable protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
[processing status](https://developers.google.com/youtube/v3/guides/implementation/videos),
[quota and compliance](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).

### TikTok

Перед каждой формой публикации вызвать Creator Info и использовать возвращённые privacy options,
disabled flags и `max_video_post_duration_sec`. Видео: `video/init`, затем либо `FILE_UPLOAD` с
PUT/chunks, либо `PULL_FROM_URL` только с подтверждённого домена. Фото/галерея: `content/init`
с `media_type=PHOTO`, только URL с подтверждённого домена. После init всегда polling publish
status.

`SHORT_VIDEO` и `VIDEO` технически идут через один video flow; различие остаётся продуктовым.
Story и text-only не поддерживаются. Draft upload (`video.upload`) считать отдельным явно
запрошенным `mode=draft`; direct post требует `video.publish`.

Проблемы: app review/audit; unaudited clients публикуют private; обязательный пользовательский UX
нельзя реализовать только stateless shell-ом; API не предназначен для внутренней утилиты
автопостинга собственной команды; динамический дневной cap; запрет нежелательных watermark;
domain verification; нельзя кэшировать Creator Info как постоянную capability.

Официальные источники: [Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started),
[sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines),
[upload draft](https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content/),
[scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes).

### X

Создание: user-context authorization и `POST /2/tweets`. Изображения сначала загружать через
официальный media upload, затем передавать `media_ids`; для большого/видео media использовать
INIT/APPEND/FINALIZE либо актуальный v2 chunked flow и STATUS. Поддержать text, одну картинку,
до четырёх изображений и одно видео. Не разрешать poll одновременно с media. SHORT и VIDEO —
один video post, Story отсутствует.

Проблемы: API платный и product tier/лимиты нельзя зашить навсегда; OAuth 2 app-only bearer не
даёт создать post; часть media документации и endpoint versions мигрирует независимо от Posts
API; weighted character count (URL имеет фиксированный вес) требует отдельного валидатора;
video duration/size зависят от доступа аккаунта; после FINALIZE обработка асинхронна.

Официальные источники: [Create posts](https://docs.x.com/x-api/posts/create-post),
[integration guide](https://docs.x.com/x-api/posts/manage-tweets/integrate),
[media upload](https://docs.x.com/x-api/media/upload-media),
[chunked upload](https://docs.x.com/x-api/media/quickstart/media-upload-chunked),
[character counting](https://docs.x.com/fundamentals/counting-characters).

### Pinterest

Image Pin создаётся через `POST /v5/pins` и всегда требует board target и media source. Video Pin:
зарегистрировать media upload, загрузить файл по выданным полям/URL, опрашивать media status до
`succeeded`, затем создать Pin с `source_type=video_id`, `media_id` и обязательным доступным
`cover_image_url`. Поддержать title, description, link и alt text в пределах актуальной схемы.

Нет text-only, Story и organic carousel. Не моделировать несколько Pins как один album: это
несколько независимых публикаций и требует отдельной продуктовой команды, не входящей в scope.
SHORT и VIDEO создают video Pin; Pinterest не гарантирует отдельную short-video сущность.

Проблемы: board обязателен; upload идёт на выданный storage endpoint и требует multipart fields;
cover image URL обязателен для video Pin; создание Pin начинается только после successful media
status; rate limits и доступ к API зависят от приложения; generic `url/bytes/blob/stream` в
текущем каталоге не соответствует одному общему flow.

Официальные источники:
[Create boards and Pins](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/),
[API v5](https://developers.pinterest.com/docs/api/v5/).

## Аудит существующего Telegram

### Что сделано правильно

- прямые Bot API HTTP-запросы без SDK и Node built-ins;
- `sendMessage`, `sendPhoto`, `sendVideo`, `sendAudio`, `sendDocument`, `sendMediaGroup`, poll,
  copy/forward и platform `file_id` покрыты тестами;
- abort/timeout, 429 `retry_after`, классификация ошибок, protected `extra` fields и ссылки для
  публичного `@channel` реализованы;
- лимиты текста 4096, caption 1024 и URL-fetch 5/20 MB вынесены в capabilities;
- album parts сохраняются, поэтому созданные сообщения не теряются;
- preview использует тот же renderer, что публикация.

### Ошибки и обязательные исправления

1. `telegramCapabilities.media.*.acceptedSources` заявляет `bytes`, `blob`, `stream`, но
   `toTelegramInput()` принимает только URL и `platformRef`. `TelegramApi` всегда посылает JSON,
   multipart upload отсутствует. До реализации multipart удалить ложные sources либо реализовать
   настоящий streaming multipart и тесты workerd.
2. `sendMediaGroup` по официальной документации требует 2–10 items, а capability задаёт
   `minMediaCount: 1`. Исправить минимум на 2; `slice(0, 10)` скрыто отбрасывает данные и должен
   быть удалён после строгой локальной валидации.
3. Album capability не задаёт состав. Bot API разрешает photo/video mix, но audio и document
   можно группировать только с тем же типом. Текущая `mapMediaTypeToTelegram()` превращает любой
   explicit type кроме video в photo, то есть audio/document в album отправляются неверно.
   Добавить корректные InputMedia variants или локально запретить эти альбомы согласно scope.
4. Тип album по URL определяется расширением; query string, CDN URL без расширения и `.webm`
   определяются неверно. Для album требовать `media[].type` либо использовать уже имеющиеся
   mime metadata/sniffing до adapter call.
5. `has_spoiler` посылается для каждого media group item, включая типы, где поле недопустимо.
   Формировать payload по конкретному InputMedia subtype.
6. `allowUnknownExtraFields: true` разрешает параметры не для того Bot API method. Нужны method-
   specific allowlists либо строгая схема; иначе preview проходит, а Telegram отвечает 400.
7. Auth validator проверяет только форму token и прямо утверждает, что token «никогда не
   истекает». Bot token может быть отозван; назвать проверку локальной shape validation и не
   выдавать её за проверку действительности credentials.
8. В BloggerDog `VIDEO` и `STORY` сейчас допускают `minCount: 0` и любые media, хотя adapter
   `PostType.VIDEO` требует ровно одно video, а настоящего Telegram Story publish flow здесь нет.
   Это интеграционное расхождение: BloggerDog должен маппить свои editorial types на фактические
   transport types и не обещать Telegram Stories.
9. Новые возможности Bot API (например live photo и direct message topics) не входят в scope, но
   capability source нужно периодически перепроверять. Отсутствие поддержки должно быть явным,
   а не интерпретироваться как обычное фото.

Официальный источник: [Telegram Bot API](https://core.telegram.org/bots/api), в частности
`sendMediaGroup`, `InputMediaPhoto`, `InputMediaVideo`, `InputMediaAudio`, `InputMediaDocument` и
раздел Sending Files.

## Порядок реализации

1. Исправить Telegram contract/capabilities и добавить регрессионные тесты на перечисленные
   расхождения.
2. Расширить core типом `shortVideo`, точными media/video rules, multipart helpers и безопасным
   async/resume contract; обновить conformance suite.
3. Исправить platform catalog только подтверждёнными официальными значениями и отдельными
   `verifiedAt`; не использовать generic media limits как обещание реализации.
4. Реализовать `platform-youtube` первым: он проверит resumable upload и processing contract.
5. Реализовать container-based `platform-threads` и `platform-instagram`, переиспользуя только
   внутренние source-файлы без создания runtime package dependency между adapters.
6. Реализовать `platform-facebook` с атомарным учётом partial unpublished media.
7. Реализовать `platform-tiktok` вместе с dynamic creator-info validation и обязательным UX
   контрактом для host.
8. Реализовать `platform-x` и `platform-pinterest`, проверив актуальные product access и media
   upload versions непосредственно перед кодированием.
9. Для каждого пакета: README, auth validator, capabilities с official sources, HTTP/error layer,
   adapter, recorded fixtures, unit tests, conformance tests и workerd tests.
10. Подключить пакеты в root tsconfig/publish scripts/server Docker workspace и `PLATFORMS`,
    обновить `.env.example`, `config.yaml`, OAuth docs, examples, permanent platform matrix и
    `docs/CHANGELOG.md`.
11. Выполнить `pnpm validate`; перед выпуском — `pnpm validate:all`, sandbox accounts и ручные
    smoke tests каждого поддержанного content flow.

## Критерии готовности одной платформы

- каждый объявленный тип действительно проходит до официального create endpoint;
- unsupported combinations отклоняются до первого HTTP-запроса;
- ни один input не объявлен поддержанным, если transport не умеет его передать;
- upload можно прервать и продолжить без второго поста или потери offset;
- async publish возвращает persisted JSON handle и завершается через `checkStatus()`;
- токены, upload URLs и чувствительные response fields отсутствуют в логах и safe raw output;
- scopes, app review, account type, dynamic limits и target описаны в README;
- нет SDK, Node built-ins и runtime dependencies;
- unit, conformance, workerd и server integration tests проходят;
- официальные ссылки и дата проверки находятся рядом с capabilities.

## Неучтённые продуктовые решения

До реализации нужно согласовать:

- является ли `mode=draft` общим продуктовым обещанием или только TikTok/YouTube-specific mode;
- кто предоставляет временные публичные URL для Meta/TikTok URL-pull: BloggerDog/object storage
  или adapter (stateless library не должна владеть storage);
- как BloggerDog хранит `ResumeHandle`, `PostPart` и processing state между задачами очереди;
- нужен ли multi-post fallback для длинного ARTICLE/NEWS. По умолчанию — отказ, потому что
  автоматическая разбивка создаёт несколько постов и меняет смысл операции;
- что считать успехом для YouTube: получение video ID или завершение processing;
- какие account/app review credentials доступны для обязательных end-to-end smoke tests;
- должен ли сервер принимать большие stream uploads, или production contract ограничивается
  object-storage URL и embedded library calls.
