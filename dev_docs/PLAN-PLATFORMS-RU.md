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
как часть создания.

**Горизонт планирования шире границ итерации.** Ядро проектируется не под эти семь сетей, а под
Mastodon, Bluesky, Vimeo, WhatsApp Channels, Discord, Reddit, LinkedIn и региональные сети
(VK, OK, Dzen, Rutube, Weibo, LINE, Kakao). Каждое решение по ядру ниже проверено вопросом
«переживёт ли оно Mastodon и VK», а не только «хватит ли для Instagram».

## Что означает «всё, что поддерживает BloggerDog»

В `../bloggerdog` найдены типы `POST`, `ARTICLE`, `NEWS`, `VIDEO`, `SHORT`, `STORY` и медиа
`IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`. `ARTICLE` — самостоятельный нативный формат: у него есть
заголовок, расширенная структура/форматирование и изображения внутри документа, а не только
вложения рядом с текстом. Его можно объявлять только для сети с настоящим API статей. Если
такого API нет, пользователь должен выбрать `POST`; библиотека не преобразует `ARTICLE` в post
и возвращает `unsupported`. В текущем списке платформ нативных статей нет. В будущем этот тип
предназначен для Telegra.ph, VK Articles, сайта-блога и других подтверждённых article APIs.

`NEWS` — продуктовая разновидность обычного поста и может отображаться на `post`, `image` или
`album`. Нельзя молча превращать остальные неподдерживаемые типы в другой формат.

Требуемое отображение:

| BloggerDog     | Библиотечный тип/режим       | Назначение                                 |
| -------------- | ---------------------------- | ------------------------------------------ |
| `POST`, `NEWS` | `post`, `image` или `album`  | текст, одна картинка, галерея              |
| `ARTICLE`      | `article`                    | только нативная статья с document content  |
| `VIDEO`        | `video`                      | обычное горизонтальное видео               |
| `SHORT`        | новый явный тип `shortVideo` | Reel, Short или TikTok video               |
| `STORY`        | `story`                      | только сети с официальным endpoint Stories |

Ориентация сама по себе недостаточна для выбора формата: вертикальное видео может быть Reel,
обычным видео или Story. `SHORT`/`STORY` должны приходить явно. Для `POST` сохраняется
автоопределение `post`/`image`/`album` по медиа.

## Матрица первой версии

`Да` означает отдельный официальный create-flow. `NEWS как post` означает явное продуктовое
отображение новости на обычную публикацию. `Нет` означает локальный отказ до сетевого запроса.

| Платформа              | Текст | 1 фото | Галерея               | SHORT                                  | VIDEO             | STORY                                    | ARTICLE/NEWS                 |
| ---------------------- | ----- | ------ | --------------------- | -------------------------------------- | ----------------- | ---------------------------------------- | ---------------------------- |
| Facebook Page          | Да    | Да     | Да                    | Reels                                  | Да                | проверить Page Stories перед реализацией | Нет; NEWS как post           |
| Threads                | Да    | Да     | carousel              | видео-пост, не отдельный формат        | Да                | Нет                                      | Нет; NEWS как post           |
| Instagram professional | Нет   | Да     | carousel              | Reel                                   | Reel/видео        | Да                                       | Нет; NEWS только с media     |
| YouTube                | Нет   | Нет    | Нет                   | `videos.insert`, классификация YouTube | `videos.insert`   | Нет                                      | Нет; NEWS как metadata видео |
| TikTok                 | Нет   | Да     | photo post            | video direct post                      | video direct post | Нет                                      | Нет; NEWS только с media     |
| X                      | Да    | Да     | до 4 изображений      | video post                             | video post        | Нет                                      | Нет; NEWS как post           |
| Pinterest              | Нет   | Да     | Нет в organic Pins v5 | video Pin                              | video Pin         | Нет                                      | Нет; NEWS только с media     |

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
- OAuth 2 token refresh (`OAuth2TokenRefresher`, single-flight) и внешний `CredentialProvider`
  с `onCredentialsRefreshed`;
- `runChunkedUpload()`, `ResumeHandle`, `processing` и `checkStatus()`;
- декларативные capabilities, preview и conformance suite;
- `ErrorCode` уже различает `AUTH_REFRESH_REQUIRED`, `QUOTA_EXCEEDED` и `CONTENT_REJECTED` —
  ровно те три исхода, которые хосту нужно показывать пользователю по-разному;
- `Issue` со стабильным `code` + `params` — основа для локализации на стороне хоста;
- сервер допускает регистрацию массива модулей платформ.

### Блокирующие изменения ядра до адаптеров

Пункты 1–11 — то, что нужно этим семи сетям. Пункты 12–21 — то, без чего ядро не переживёт
следующие десять сетей; их дешевле сделать сейчас, потому что все они меняют публичные типы.

1. Добавить явный `PostType.SHORT_VIDEO`. Текущее расширяемое строковое объединение позволяет
   передать неизвестную строку, но `detectPostType()`, каталог, preview и conformance не имеют
   общей семантики SHORT. Старый алиас не оставлять.
2. Спроектировать отдельный `ArticleDocument`: обязательный title и упорядоченные block nodes
   (paragraph/heading/list/quote/code/image и необходимые rich-text marks). Текущие `body` и
   `media[]` не сохраняют позиции изображений внутри статьи. `PostType.ARTICLE` должен требовать
   этот документ, а capability — явно перечислять допустимые blocks/marks. Ни один из семи
   текущих адаптеров `ARTICLE` не объявляет.
3. Разделить «тип публикации» и «набор вложений». Сейчас `ALBUM` определяется при двух любых
   медиа, хотя допустимость смешанного набора платформозависима. Нужны точные `mediaCounts` и
   platform validation hooks.
4. Добавить декларативные видео-ограничения: aspect ratio/width/height, duration, codec/container,
   frame rate и требование cover. Сейчас часть из них можно проверить только вручную в адаптере.
5. Уточнить модель асинхронного результата. Meta containers, TikTok, X video processing,
   Pinterest video и YouTube требуют polling. `checkStatus()` подходит, но handle должен хранить
   только JSON-состояние, без access token и подписанного upload URL в логах/raw.
6. Добавить безопасный helper для multipart/form-data и single/multipart upload на Web APIs.
   `runChunkedUpload()` покрывает offset-based протоколы, но не все init/finalize/status варианты.
7. Не считать generic retry публикации безопасным. Повторять можно только адресованный chunk или
   status call. После неопределённого ответа create/publish нужна платформа-специфичная проверка;
   иначе возможны дубликаты.
8. OAuth различается: Meta long-lived token exchange, Threads refresh, Google refresh token,
   TikTok rotation, X OAuth 2 PKCE/OAuth 1.0a и Pinterest refresh нельзя выразить одним статическим
   token endpoint без platform config. Authorization flow остаётся у host, но документировать
   обязательные scopes, target IDs и refresh strategy необходимо для каждого пакета.
9. HTTP shell с JSON/base64 и общим body limit не годится для больших видео. Для Node/Workers
   нужны URL/stream source либо отдельный streaming ingress; нельзя материализовать YouTube/TikTok
   видео в JSON или памяти Worker.
10. Каталог — только предварительная справка. Перед реализацией исправить в нём неподтверждённые
    значения: generic media sources у Facebook/Pinterest, YouTube MIME как только
    `application/octet-stream`, TikTok `ALBUM` из 1 элемента, а также отсутствие различия
    Reel/Story/обычного video.
11. В конфигурации нужны platform-specific target: Facebook Page ID, Meta/Threads/Instagram user
    ID, YouTube channel из токена, TikTok open ID/creator context, Pinterest board ID.

## Ядро под 20+ сетей: что ещё нужно изменить

Проверка ядра против Mastodon, Bluesky, Vimeo, WhatsApp Channels, Discord, Reddit и региональных
сетей выявила семь мест, где текущая модель не расширяется, а ломается. Все они — изменения
публичных типов, поэтому делаются до первого нового адаптера, а не после.

### 12. `target` должен быть структурой, а не скаляром

Сейчас `target?: string | number`. Этого хватает для Telegram и для wire contract, но не хватает
как модели:

- Pinterest: board **и** опционально section;
- Reddit: subreddit **и** flair id;
- Discord: guild **и** channel;
- Facebook: Page ID, при этом Instagram того же бизнеса — другой ID;
- WhatsApp: WABA **и** channel;
- Mastodon/Bluesky: аккаунт вообще не адресуется одной строкой без хоста инстанса.

Решение: `target?: string | number | PlatformTarget`, где `PlatformTarget` — объект с
`id: string` и платформенными полями, описанными в `capabilities.targetSchema` (тем же
механизмом `ExtraFieldSpec`, что уже есть для `extra`). Скаляр остаётся допустимым сокращением
для сетей с одним идентификатором и не ломает существующие вызовы, включая `PostRef.target`.

Отдельно: в `PLAN` ранее было написано, что «одного неструктурированного `target` достаточно».
Это верно только пока в списке нет ни одной сети с составным адресом. Pinterest есть уже в этой
итерации, поэтому пункт закрывается сейчас.

### 13. API host — свойство аккаунта, а не платформы

Mastodon, Bluesky (PDS), Matrix, self-hosted сети и региональные API-домены не имеют одного
базового URL. `AccountConfig` должен явно объявлять `apiBaseUrl?: string`, а capability —
`requiresApiBaseUrl: boolean`. Сейчас базовый URL зашит в адаптер, и первый же Mastodon-аккаунт
на чужом инстансе это сломает. Изменение дешёвое, но затрагивает `PlatformDeps` и каждый адаптер,
поэтому делается до того, как адаптеров станет восемь.

### 14. Динамические capabilities: `resolveCapabilities(account)`

Самый крупный пробел. `IPlatform.capabilities` — статическое поле (`readonly capabilities`).
Но обязательные к учёту ограничения не статические:

| Сеть      | Что известно только в рантайме                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------ |
| TikTok    | Creator Info: privacy options, disabled flags, `max_video_post_duration_sec` — **перед каждым постом** |
| Instagram | оставшаяся publish quota (rolling window)                                                              |
| Mastodon  | `/api/v1/instance`: лимит символов, число вложений, размеры, форматы                                   |
| Reddit    | правила сабреддита, обязательный flair                                                                 |
| X         | лимиты product tier                                                                                    |
| Vimeo     | оставшаяся квота хранилища аккаунта                                                                    |

Нужен второй, необязательный член интерфейса:

```ts
resolveCapabilities?(
  accountConfig: ResolvedAccountConfig,
  signal?: AbortSignal,
): Promise<PlatformCapabilities>;
```

с контрактом: результат — merge статического дескриптора и рантайм-значений; библиотека его
**не кэширует** (кэш — состояние, а библиотека stateless), а возвращает вместе с
`cacheableForSecs?: number`, чтобы хост сам решил, что положить в Redis. TikTok Creator Info
получает `cacheableForSecs: 0` и вызывается всегда. Без этого механизма каждый адаптер
изобретёт собственный, и `preview()` перестанет быть достоверным.

### 15. Push или pull: транспорт медиа нужно объявлять

`MediaConstraints.acceptedSources` говорит, _что_ можно передать, но не говорит, **кто тянет
байты**. Разница принципиальная для хоста: при pull-модели подписанный URL уходит третьей стороне
и должен пережить всё окно обработки.

Добавить в `MediaConstraints`:

- `transport: 'push' | 'pull' | 'both'`;
- `requiresPubliclyFetchableUrl?: boolean`;
- `urlMustRemainAvailableForSecs?: number` — минимальный срок жизни подписанной ссылки.

Последнее поле напрямую связано с реальной ошибкой у потребителя: BloggerDog формирует подписанный
media-URL в момент сборки снапшота и замораживает его в `preparedPayload`, а публикация может
произойти сильно позже. Для Telegram это незаметно, для Meta это провал публикации.

### 16. Типизированный и неймспейсированный `extra`

`extra?: Record<string, unknown>` + рантайм-`ExtraFieldSpec[]` — правильная основа, но:

- у потребителя нет типов: BloggerDog разворачивает `platformOptions[PLATFORM]` в плоский
  `request.extra` и теряет проверку на этапе компиляции;
- при fan-out одной публикации на 15 сетей плоский `extra` неизбежно даёт коллизии ключей.

Решение: каждый пакет платформы экспортирует свой интерфейс (`TelegramExtra`, `YouTubeExtra`, …),
а `PostRequest` становится дженериком `PostRequest<TExtra = Record<string, unknown>>`. Рантайм-
валидация по `ExtraFieldSpec` остаётся источником истины; дженерик — только удобство. Значение
по умолчанию сохраняет обратную совместимость.

### 17. Реестр имён типов постов

`PostType` — открытое объединение `(string & {})`. Это хорошо для расширяемости и плохо для
согласованности: два адаптера напишут `shortVideo` и `short_video`, и `detectPostType`, каталог и
conformance разойдутся. Нужен один экспортируемый список канонических имён в ядре (включая
зарезервированные на будущее: `shortVideo`, `story`, `thread`, `article`, `event`, `live`) и
проверка в `validateCapabilities()`, что все ключи `postTypes` либо канонические, либо явно
помечены как платформенное расширение. Стоимость — один массив; экономия — отсутствие
несовместимого зоопарка через десять сетей.

### 18. Треды как явный ввод, а не как побочный эффект

X, Mastodon, Bluesky и Threads поддерживают нативные цепочки. Сейчас в `PostRequest` есть только
`inReplyTo`, то есть цепочку хост собирает сам, вручную, повторяя логику для каждой сети, и при
падении на третьем сообщении остаётся с полупубликацией без resume handle.

Ядро должно принять `thread?: PostSegment[]` (каждый сегмент — `body`, `media`, `poll`), а
capability — объявлять `thread: { supported, maxSegments, maxSegmentBodyLength }`. Результат
возвращается через уже существующие `parts[]`, а сбой в середине — через уже существующий
`ResumeHandle`. Автоматическая нарезка длинного текста при этом **не** делается: разбивка меняет
смысл операции и остаётся решением вызывающего.

Это не входит в первую итерацию по реализации, но тип должен появиться сейчас, потому что он
влияет на форму `PostResponse.parts` и на контракт resume.

### 19. Адаптация запроса как функция ядра

BloggerDog содержит `utils/strategies/` с `AbstractPlatformFormatter`, `TelegramFormatter` и
`DefaultFormatter` — то есть переписывает платформенную подгонку контента у себя. С ростом до 15
сетей это станет вторым, несогласованным набором знаний о сетях.

`preview()` уже возвращает `convertedBody`, `truncated` и `ignoredFields`. Нужно расширить его до
возврата полностью адаптированного запроса: `adaptedRequest: PostRequest`. Тогда хост строит один
нейтральный `PostRequest` из своей доменной модели и получает от библиотеки готовый платформенный
вариант, вместо того чтобы писать форматтер на каждую сеть.

### 20. Квоты как данные, а не как комментарий

`RateLimits` содержит `postsPerHour/postsPerDay/note`. Этого мало: у YouTube расход считается в
quota units и один upload стоит несопоставимо дороже чтения, у Vimeo ограничение — объём
хранилища, у Instagram — скользящее окно. Добавить `quotaCost?: { unit: string; perPublish?: number }`
и необязательный `getQuota?(accountConfig)` для сетей с официальным endpoint остатка.

### 21. Зарезервировать форму `edit()` сейчас

Редактирование не входит в итерацию, и это правильно. Но Telegram, Mastodon, Bluesky, VK и
LinkedIn его поддерживают, а `PostRef`/`PostPart` — именно та структура, которую редактирование
будет принимать. Достаточно объявить необязательный `edit?(ref, request, accountConfig, options)`
в `IPlatform` без реализаций, чтобы потом не менять модель ссылки на пост, когда в базе хоста уже
лежат миллионы `ref`.

## Потребитель: `../bloggerdog`

### Как использует сейчас

- зависимости `@bozonx/social-posting` и `@bozonx/social-posting-telegram` подключены как
  `file:` из этого репозитория;
- `createPostingClient({ accounts: {}, platforms: getPostingPlatformModules() })` — **пустой**
  `accounts`, `CredentialProvider` не используется; учётные данные передаются инлайном в каждом
  запросе через `request.auth`;
- `SocialPostingRequestFormatter` + стратегии собирают `PostRequest` из снапшота публикации;
- медиа отдаётся как `{ kind: 'url' }` через подписанный публичный эндпоинт
  `/media/p/:id/:token`, а Telegram-медиа — как `{ kind: 'platformRef' }` с `file_id`;
- `processing` и `resumeHandle` уже поддержаны: handle кладётся в JSON-колонку `post.meta.posting`,
  есть очередь BullMQ и цикл `checkStatus()`;
- `preview()` используется для проверки канала (`testChannel`).

Это хорошая база: асинхронный контракт библиотеки уже реально работает у потребителя, а не только
в тестах.

### Что сломается при добавлении основных сетей

1. **Модель учётных данных не переживёт OAuth.** `PlatformCredentialSet` — закрытое объединение
   из `telegramBotToken`/`vkAccessToken`/`apiKey`, а `resolvePlatformParams()` возвращает
   `{ channelId, apiKey }`. Ни `accessToken`, ни `refreshToken`, ни `expiresAt`, ни `scopes` в
   модели нет. Для Meta/YouTube/TikTok/X/Pinterest нужно: колонки под токены, реализация
   `CredentialProvider` поверх БД, обязательный `onCredentialsRefreshed` (ротируемый refresh token,
   который не сохранили, блокирует аккаунт навсегда), и обработка `AUTH_REFRESH_REQUIRED` как
   «канал требует переавторизации», а не как ошибку публикации.
2. **`{ channelId, apiKey }` — это тот самый скалярный target из пункта 12.** Pinterest board,
   Facebook Page + Instagram user, TikTok open id в эту пару не помещаются.
3. **Тип поста теряется.** Форматтеры **не выставляют `request.type` вообще**; библиотека
   определяет его из медиа. Значит prisma-типы `SHORT` и `STORY` до библиотеки не доезжают, и
   вертикальное видео уедет обычным видео-постом. Отображение prisma `PostType` → библиотечный
   `type` нужно добавить в форматтер до первой сети с Reels.
4. **`SocialMedia` enum содержит `TELEGRAM`, `VK`, `SITE`.** То есть реальные ближайшие
   потребности потребителя — VK и собственный сайт-блог (нативные статьи), а их в плане нет
   вовсе. Это следует зафиксировать как отдельную ветку работ, а не подразумевать.
5. **Окно ожидания обработки слишком короткое.** `MAX_STATUS_CHECKS = 30` и
   `MAX_STATUS_CHECK_DURATION_MS = 15 минут`. Обработка видео на YouTube регулярно выходит за 15
   минут; TikTok и Instagram — реже, но выходят. Окно должно задаваться на сеть, а не одной
   константой, и библиотека должна отдавать `checkAfterMs` как основу расписания (она уже отдаёт).
6. **Замороженный `preparedPayload` и подписанные URL.** Снапшот запроса сохраняется в БД заранее,
   а подписанный media-URL в нём имеет срок жизни. Для pull-based сетей (Meta, TikTok) ссылка
   должна быть валидна не в момент сборки снапшота, а всё время обработки на стороне сети —
   см. пункт 15.
7. **`platformOptions` разворачиваются в плоский `extra`** с приведением ключа платформы к
   верхнему регистру — при пятнадцати сетях это источник коллизий, см. пункт 16.
8. **Собственные форматтеры на каждую сеть** — см. пункт 19.

### Что должно остаться неизменным

Резюме-контракт, JSON-сериализуемость `ResumeHandle` и отсутствие секретов в нём — не
теоретическое требование: BloggerDog кладёт handle в обычную JSON-колонку БД и логирует ответы.
Любой адаптер, положивший в handle upload URL или токен, немедленно создаст утечку у потребителя.

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
endpoint (это `resolveCapabilities()` из пункта 14, а не статическая константа); container expiry;
асинхронная обработка; требования к aspect ratio/duration/codecs; carousel не равен Story;
caption/hashtag limits могут изменяться.

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
domain verification; Creator Info возвращается через `resolveCapabilities()` с
`cacheableForSecs: 0` и никогда не кэшируется как постоянная capability.

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
API; weighted character count (URL имеет фиксированный вес) требует отдельного валидатора —
`bodyLengthRule.urlWeight` в ядре уже есть и должен использоваться, а не дублироваться в адаптере;
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

Проблемы: board обязателен и является составным target (пункт 12); upload идёт на выданный
storage endpoint и требует multipart fields; cover image URL обязателен для video Pin; создание
Pin начинается только после successful media status; rate limits и доступ к API зависят от
приложения; generic `url/bytes/blob/stream` в текущем каталоге не соответствует одному общему flow.

Официальные источники:
[Create boards and Pins](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/),
[API v5](https://developers.pinterest.com/docs/api/v5/).

## Порядок реализации

1. Расширить core типом `shortVideo`, моделью `ArticleDocument`, точными media/video rules,
   multipart helpers и безопасным async/resume contract; обновить conformance suite.
2. **Изменения ядра под будущие сети (пункты 12–21), пока адаптер один.** Структурный `target`,
   `apiBaseUrl` в аккаунте, `resolveCapabilities()`, транспорт медиа push/pull, дженерик `extra`,
   реестр имён типов, тип `thread`, `adaptedRequest` в preview, quota-модель и заглушка `edit()`.
   Это единственный момент, когда такие правки стоят один рефакторинг вместо восьми.
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
    обновить `.env.example`, `config.yaml`, OAuth docs, examples, permanent platform matrix,
    `docs/PLATFORM-SPECIFICS.md` и `docs/CHANGELOG.md`.
11. Выполнить `pnpm validate`; перед выпуском — `pnpm validate:all`, sandbox accounts и ручные
    smoke tests каждого поддержанного content flow.

Контрольная точка после шага 2: взять Mastodon как проверочную сеть на бумаге и убедиться, что её
можно описать без изменений ядра — свой хост инстанса, динамические лимиты, треды, idempotency
key, alt text. Если нельзя, ядро ещё не готово, и это дешевле узнать до шага 4.

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
- официальные ссылки и дата проверки находятся рядом с capabilities;
- раздел сети добавлен в `docs/PLATFORM-SPECIFICS.md`.

## Продуктовые решения

Ранее этот раздел назывался «Неучтённые» и содержал открытые вопросы. Ниже — принятые решения с
обоснованием. Каждое можно оспорить, но не молча.

### 1. `mode=draft` — общий контракт, но не общее обещание

`mode: 'publish' | 'draft'` остаётся в ядре как общий словарь, потому что черновики есть у YouTube
(`privacyStatus: private`), TikTok (`video.upload`), LinkedIn и VK. Но поддержка объявляется
**только** через `capabilities.supportsDraft`, и сеть без черновика отвергает `mode: 'draft'` как
`unsupported`, а не публикует. Категорически нельзя эмулировать черновик публикацией с
ограниченной видимостью: у YouTube это уже стоит полной квоты и создаёт реальный объект, и
называть это черновиком — вводить пользователя в заблуждение. `private`-загрузка YouTube — это
`mode: 'publish'` с `visibility: 'private'`, и в README это должно быть написано прямо.

### 2. Временные публичные URL предоставляет хост

Библиотека не владеет storage и не будет им владеть — это ломает и stateless-контракт, и работу
в Workers. Для pull-based сетей URL даёт хост. У BloggerDog это уже реализовано
(`/media/p/:id/:token`) и менять архитектуру не нужно; нужно изменить **срок жизни и момент
выдачи**: токен должен выпускаться в момент публикации, а не замораживаться в снапшоте, и жить не
меньше `urlMustRemainAvailableForSecs` из capability (пункт 15).

Ответственность библиотеки — три вещи: объявить `transport: 'pull'` в capability, отвергнуть
`bytes/blob/stream` до сетевого вызова с внятным `Issue`, и задокументировать требование к сроку
жизни ссылки. Адаптер, который «сам где-нибудь разместит файл», не будет принят.

### 3. Хранение resume/processing состояния — как уже сделано в BloggerDog, с двумя правками

Текущая схема правильная: `ResumeHandle` в JSON-колонке `post.meta.posting`, очередь BullMQ,
отдельный статус `PROCESSING` на посте. Правки:

- окно ожидания перестаёт быть глобальной константой в 15 минут; библиотека отдаёт `checkAfterMs`,
  а предельный срок берётся из capability сети (YouTube выходит за 15 минут штатно);
- `PostRef.parts` должен сохраняться целиком, а не сводиться к `postId`. Публикация Facebook
  gallery или треда — несколько объектов, и по одному ID их потом не убрать и не отредактировать.

### 4. Multi-post fallback для длинного `NEWS` — нет; вместо него явный `thread`

Автоматическая нарезка одного поста на несколько по достижении лимита отклоняется: она молча
меняет одну операцию на N, ломает `ref`, дедупликацию и статистику, а результат почти всегда хуже
человеческой разбивки. Вместо этого — явный `thread?: PostSegment[]` (пункт 18): вызывающий сам
решает разбить и видит это в своей модели. Длинный текст без `thread` для сети с меньшим лимитом
даёт `Issue` в `preview()` заранее, а не сюрприз при публикации. `ARTICLE` fallback не получает
ни в каком виде: он существует только через нативный article API.

### 5. Успех YouTube — это полученный video ID

`videos.insert` вернул идентификатор → публикация создана, `status: 'processing'`, `handle`
отдан. Это соответствует и реальности (видео существует, квота списана, отмена не бесплатна), и
уже работающей модели BloggerDog. Ждать окончания обработки внутри `post()` нельзя: обработка
идёт минутами, а библиотека не имеет права держать соединение и не имеет планировщика. Пост
переходит в `PUBLISHED` у хоста после `checkStatus()`, вернувшего `published`, и это тот же путь,
что у Meta и TikTok.

### 6. Учётные записи для smoke tests — блокирующее требование, не пожелание

Ни одна сеть не выпускается без ручного end-to-end прогона на настоящем аккаунте нужного вида:
Facebook Page, Instagram professional, верифицированный YouTube-канал с проверенным consent
screen, аудированное TikTok-приложение, платный tier X, Pinterest-аккаунт с board. Для TikTok и
X получение доступа — сроки в недели, поэтому заявки подаются **до** начала кодирования
соответствующего пакета, а не после. Если доступа нет — пакет не выпускается, даже если код
написан и тесты на фикстурах зелёные; фикстуры не доказывают наличие прав.

### 7. HTTP shell не принимает большие потоки

Production-контракт сервера: `url`-источник или встроенный вызов библиотеки. JSON/base64 остаётся
для маленьких файлов, для видео — только URL. Причина: Workers имеют жёсткие лимиты тела и
длительности запроса, а материализация видео в памяти воркера — это отказ в обслуживании при
первом же ролике. Отдельный streaming ingress — самостоятельная задача с собственной моделью
аутентификации и квот, и в этот scope она не входит. В `docs/RUNTIMES.md` и README сервера
ограничение должно быть сформулировано явно, а не выведено читателем из лимита тела.
