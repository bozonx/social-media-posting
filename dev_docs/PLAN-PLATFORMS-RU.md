# План добавления платформ публикации

Статус проверки: 29 августа 2026 года.

## Цель и границы

Добавить отдельные пакеты-адаптеры для Facebook, Threads, Instagram, YouTube, TikTok, X,
Pinterest, Mastodon, Bluesky, Vimeo, Discord, LinkedIn, Dailymotion, Pixelfed и Truth Social.
Это **весь основной набор**: региональные и специфические сети добавляются не в этой работе.
Адаптеры используют только Web APIs (`fetch`, `Request`, `Response`, WHATWG streams,
Web Crypto) и прямые HTTP-запросы. SDK поставщиков и runtime-зависимости запрещены.

**WhatsApp Channels — отвергнуто.** Решение окончательное: публичного API публикации обновлений
канала не существует, пакета не будет, в порядок реализации сеть не входит. Подробности — в
разделе «WhatsApp Channels — отвергнуто, адаптер не планируется».

Pixelfed и Truth Social — не отдельные пакеты, а дескрипторы поверх `platform-mastodon`
(механизм диалектов, пункт 22). Truth Social дополнительно ждёт подтверждения условий доступа.

**Отвергнуты и в набор не входят:** WhatsApp Channels (публичного API для публикации обновлений
канала не существует), Reddit, Snapchat, Twitch. Обоснование по каждой — в разделе
«Границы сервиса».

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
весь набор целиком — включая федеративные сети (Mastodon, Pixelfed, Truth Social, Bluesky),
видеохостинги (Vimeo, Dailymotion), Discord и LinkedIn — и с запасом на региональные сети
(VK, OK, Dzen, Rutube, Weibo, LINE, Kakao), которые придут не скоро. Каждое решение по ядру ниже
проверено вопросом «переживёт ли оно Mastodon и VK», а не только «хватит ли для Instagram».

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
| Mastodon               | Да    | Да     | до 4 вложений         | видео-пост, не отдельный формат        | Да                | Нет                                      | Нет; NEWS как post           |
| Bluesky                | Да    | Да     | до 4 изображений      | видео-пост, не отдельный формат        | Да                | Нет                                      | Нет; NEWS как post           |
| Vimeo                  | Нет   | Нет    | Нет                   | обычная загрузка видео                 | Да                | Нет                                      | Нет; NEWS как metadata видео |
| Dailymotion            | Нет   | Нет    | Нет                   | обычная загрузка видео                 | Да                | Нет                                      | Нет; NEWS как metadata видео |
| Discord                | Да    | Да     | до 10 вложений        | обычное видео-вложение                 | Да                | Нет                                      | Нет; NEWS как post           |
| LinkedIn               | Да    | Да     | несколько изображений | обычный видео-пост                     | Да                | Нет                                      | Нет (нет API статей)         |
| Pixelfed               | Нет   | Да     | до 4 вложений         | видео-пост, не отдельный формат        | Да                | Нет                                      | Нет; NEWS только с media     |
| Truth Social           | Да    | Да     | до 4 вложений         | видео-пост, не отдельный формат        | Да                | Нет                                      | Нет; NEWS как post           |

Важно: смешанная коллекция изображений и видео поддерживается не везде. Она не должна
объявляться как общий `album`, пока правила конкретной сети не подтверждены. TikTok photo post
— коллекция только изображений; X — либо до четырёх изображений, либо одно видео/GIF;
Pinterest v5 создаёт один image/video Pin, а не органическую карусель. У Mastodon число и типы
вложений — конфигурация инстанса, поэтому «до 4» здесь ориентир, а не декларируемый лимит:
фактическое значение берётся из `resolveCapabilities()`. То же относится к Pixelfed и Truth
Social. У LinkedIn отдельным публикуемым типом является `document` (PDF-карусель) — единственная
сеть набора, где медиа-тип `document` становится типом поста. У Discord число вложений
фиксировано, а вот их предельный размер зависит от boost-уровня сервера.

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

Пункты 1–11 — то, что нужно этим семи сетям. Пункты 12–23 — то, без чего ядро не переживёт
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

Проверка ядра против Mastodon, Bluesky, Vimeo, Discord, LinkedIn и региональных
сетей выявила семь мест, где текущая модель не расширяется, а ломается. Все они — изменения
публичных типов, поэтому делаются до первого нового адаптера, а не после.

### 12. `target` должен быть структурой, а не скаляром

Сейчас `target?: string | number`. Этого хватает для Telegram и для wire contract, но не хватает
как модели:

- Pinterest: board **и** опционально section;
- Discord: webhook, в котором guild и channel зашиты в сам секрет;
- Discord с bot token: guild **и** channel;
- Facebook: Page ID, при этом Instagram того же бизнеса — другой ID;
- LinkedIn: автор — участник или организация, и это разные URN с разными правами;
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
поэтому делается до того, как адаптеров станет пятнадцать.

### 14. Динамические capabilities: `resolveCapabilities(account)`

Самый крупный пробел. `IPlatform.capabilities` — статическое поле (`readonly capabilities`).
Но обязательные к учёту ограничения не статические:

| Сеть      | Что известно только в рантайме                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------ |
| TikTok    | Creator Info: privacy options, disabled flags, `max_video_post_duration_sec` — **перед каждым постом** |
| Instagram | оставшаяся publish quota (rolling window)                                                              |
| Mastodon  | `/api/v1/instance`: лимит символов, число вложений, размеры, форматы                                   |
| Discord   | предельный размер вложения зависит от boost-уровня сервера                                             |
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

### 22. Один адаптер — несколько сетей: диалекты API

Mastodon, Pixelfed и Truth Social — это **один и тот же HTTP API**. Pixelfed и Truth Social
реализуют Mastodon-совместимый интерфейс; отличаются хост, набор поддерживаемых типов и лимиты,
а не протокол. То же верно для семейства ActivityPub-видео (PeerTube — свой API, но тоже
per-instance) и в будущем для любого форка.

Сейчас `PlatformModule.name` — одна строка, и реестр отображает имя на модуль один к одному.
Значит Pixelfed потребует копию пакета Mastodon. Через три форка это станет тремя копиями
одного кода с разъезжающимися исправлениями.

Нужно разделить **реализацию протокола** и **имя сети**:

```ts
export interface PlatformModule {
  name: string;
  /** Протокол/диалект, если реализация общая: 'mastodon-api', 'atproto'. */
  dialect?: string;
  capabilities: PlatformCapabilities;
  create(deps: PlatformDeps): IPlatform;
  authValidator?: IAuthValidator;
}

/** Тот же код под другим именем, с другими capabilities и дефолтами. */
export function deriveModule(
  base: PlatformModule,
  overrides: { name: string; capabilities: PlatformCapabilities },
): PlatformModule;
```

Тогда `platform-mastodon` экспортирует `mastodon`, `pixelfed` и (если пройдёт по ToS)
`truthSocial` из одного набора исходников, с разными дескрипторами. Стоимость сейчас — одна
функция; стоимость потом — рефакторинг трёх пакетов с расходящейся историей.

Это же снимает вопрос «а как назвать платформу для self-hosted инстанса»: имя платформы остаётся
`mastodon`, а инстанс задаётся `apiBaseUrl` в аккаунте (пункт 13).

### 23. OAuth client не всегда глобальный

`OAuth2Config` предполагает один статический `tokenEndpoint` + `clientId` + `clientSecret` на
платформу. Для Mastodon и Pixelfed это неверно: приложение регистрируется **на каждом инстансе**
(`POST /api/v1/apps`), и `clientId`/`clientSecret` свои у каждого сервера. То же будет у любой
федеративной сети.

Следствия:

- `OAuth2Config` должен строиться из `AccountConfig` (или разрешать функцию
  `(account) => OAuth2Config`), а не быть константой пакета;
- `CredentialProvider` хранит для таких аккаунтов не только токены, но и client credentials
  инстанса; хост обязан их персистить наравне с токеном;
- регистрация приложения на инстансе — это операция хоста (как и authorization redirect), но
  библиотека должна дать helper для формирования запроса, иначе каждый хост напишет свой.

Bluesky ломает предположение с другой стороны: там аутентификация — не OAuth2 в классическом
виде (`kind: 'custom'` в каталоге), а сессия ATProto/app password с собственным обновлением.
`OAuth2TokenRefresher` для него не подходит, и это нормально — важно, чтобы `IPlatform` не
требовал OAuth2 как единственный путь. Сейчас не требует; при рефакторинге это свойство нужно
сохранить осознанно.

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

### Mastodon

Первая федеративная сеть в наборе, и поэтому — приёмочный тест ядра, а не просто ещё один адаптер.
Публикация простая: `POST /api/v1/statuses` с `status`, `media_ids[]`, `visibility`,
`spoiler_text`, `sensitive`, `language`, `in_reply_to_id`, `poll`. Медиа загружается заранее
через `POST /api/v2/media` и может обрабатываться асинхронно (`202` → опрашивать
`GET /api/v1/media/:id` до готовности, только потом публиковать статус).

Что она проверяет в ядре:

- `apiBaseUrl` на аккаунте (пункт 13) — единого хоста нет;
- `resolveCapabilities()` (пункт 14) — лимит символов, число вложений, размеры и допустимые MIME
  берутся из `GET /api/v1/instance` и на разных серверах различаются в разы;
- per-instance OAuth client (пункт 23);
- `thread[]` (пункт 18) — цепочки нативные, через `in_reply_to_id`;
- `Idempotency-Key` — **единственная в наборе настоящая идемпотентность**; `supportsIdempotencyKey`
  в ядре уже есть и должен реально использоваться, это заметно сужает окно дублей;
- `contentWarning` + `sensitive` — единственная сеть, где оба поля не декоративны;
- alt text у вложений поддержан и должен передаваться.

Проблемы: лимиты нельзя зашивать (в каталоге они намеренно отсутствуют и профиль помечен
«instance configuration»); инстанс может отключить публикацию для приложения; часть серверов —
не Mastodon, а совместимая реализация с отличиями в необязательных полях; удаление и правка есть,
но в scope не входят.

Официальные источники: [statuses](https://docs.joinmastodon.org/methods/statuses/),
[media](https://docs.joinmastodon.org/methods/media/),
[instance](https://docs.joinmastodon.org/methods/instance/),
[apps](https://docs.joinmastodon.org/methods/apps/).

### Bluesky

AT Protocol, а не REST-API соцсети: публикация — это создание записи
`com.atproto.repo.createRecord` с коллекцией `app.bsky.feed.post`. Ближайшие следствия:

- **разметку строит клиент.** Ссылки, упоминания и теги передаются как `facets` — диапазоны в
  **байтах UTF-8**, а не в символах JavaScript. Наивный `indexOf` по строке даёт смещённые
  ссылки на любом тексте с эмодзи или кириллицей. Это отдельный, обязательно тестируемый
  компонент, а не деталь сериализации;
- лимит текста — 300 **графем**, при этом отдельно ограничен размер в байтах. Ещё один счётчик,
  который нельзя заменить на `string.length`; `bodyLengthRule` придётся расширить понятием
  единицы измерения (графемы/байты/символы);
- изображения — блобы (`com.atproto.repo.uploadBlob`), встраиваются в запись как `embed`;
  до четырёх на пост. Видео проходит через отдельный сервис и обрабатывается асинхронно;
- хост — PDS аккаунта, снова не константа (пункт 13);
- аутентификация не OAuth2 в классическом виде (пункт 23);
- цитата и репост — нативные типы записей, ложатся на существующие `repostOf`/quote.

Проблемы: запись создаётся клиентом, поэтому валидность лексикона — ответственность адаптера, а
не сервера; ошибки схемы обнаруживаются поздно; ограничения блобов зависят от PDS.

Официальные источники: [posts](https://docs.bsky.app/docs/advanced-guides/posts),
[rich text / facets](https://docs.bsky.app/docs/advanced-guides/post-richtext),
[создание записей](https://docs.bsky.app/docs/advanced-guides/atproto).

### Vimeo

Только видео, как YouTube, но с другим протоколом и другой моделью ограничений. Загрузка —
tus (resumable), плюс вариант pull по URL. После загрузки видео обрабатывается асинхронно,
статус проверяется отдельно; готовность к воспроизведению — не то же самое, что созданная
запись.

Ключевое отличие от YouTube, которое влияет на сообщение пользователю: ограничение — это
**объём хранилища аккаунта и недельная/месячная квота загрузки**, а не суточные quota units
операций. Оба случая отдаются как `QUOTA_EXCEEDED`, но текст и рекомендация («освободите место»
против «попробуйте завтра») разные, поэтому `RateLimits.quotaCost` (пункт 20) должен различать
единицу измерения.

Значимая часть уже готова: `runChunkedUpload()` и `ResumeHandle` покрывают offset-протокол;
tus добавляет свой набор заголовков и требует отдельного helper-а из пункта 6, но не новой
архитектуры.

Проблемы: доступ к загрузке зависит от тарифа аккаунта; privacy-настройки — не то же самое, что
`draft`; SHORT/STORY отсутствуют, вертикальное видео — обычное видео.

Официальные источники: [upload](https://developer.vimeo.com/api/upload/videos),
[API reference](https://developer.vimeo.com/api/reference).

### Discord

Самый дешёвый адаптер набора и единственный, который можно выпустить за день. Публикация —
`POST` сообщения в канал: `content`, `embeds[]`, вложения через `multipart/form-data`. Ни
контейнеров, ни асинхронной обработки, ни `processing`.

Две модели доступа внутри одной сети, и это главная особенность для конфигурации:

1. **Webhook URL** — без OAuth, без бота, без review. URL сам по себе является **и учётными
   данными, и адресом назначения одновременно**: гильдия и канал зашиты в него. Это единственный
   случай в наборе, когда `auth` и `target` — один и тот же секрет, и хранить его надо как
   секрет, а не как идентификатор канала.
2. **Bot token** с правами в гильдии — нужен для правки и удаления собственных сообщений и для
   более сложных сценариев; `target` здесь составной (guild + channel, пункт 12).

Адаптер должен поддержать обе и выбирать по конфигурации аккаунта, а `authValidator` — различать
их по форме. Объявлять webhook как «упрощённый вариант bot token» нельзя: у них разные
возможности (webhook не редактирует чужие сообщения, не читает канал, у него своё имя и аватар).

Особенности: лимит текста 2000 символов; **предельный размер вложения зависит от boost-уровня
сервера** — снова динамическая capability (пункт 14), а не константа; embeds — платформенный
формат, ложащийся на `extra` с описанием через `ExtraFieldSpec`; alt text у вложений
поддерживается; до 10 вложений в сообщении.

Продуктовая оговорка, которую нужно донести до BloggerDog: это канал анонсов, а не соцсеть.
Охватов и статистики за ним нет, и в интерфейсе он должен называться соответственно, иначе
пользователь будет ждать от него того, чего там не существует.

Официальные источники:
[Create Message](https://docs.discord.com/developers/resources/message#create-message),
[Webhooks](https://docs.discord.com/developers/resources/webhook),
[Uploading files](https://docs.discord.com/developers/reference#uploading-files).

### Pixelfed

Отдельного кода нет. Pixelfed реализует Mastodon-совместимый API, поэтому это `platform-mastodon`
под другим именем и с другим дескриптором возможностей — ровно тот сценарий, ради которого
вводится пункт 22.

Отличия описываются данными, а не ветвлениями в коде:

- **текстовый пост без медиа не поддерживается** — Pixelfed ориентирован на изображения; в
  `postTypes` отсутствует `post`, `media` обязательно;
- набор допустимых MIME и число вложений свои, и, как у Mastodon, задаются инстансом;
- часть необязательных полей Mastodon-API отсутствует или ведёт себя иначе; всё, что не
  подтверждено на реальном инстансе, в дескриптор не попадает.

Ценность этого пакета не в аудитории Pixelfed, а в доказательстве: если он получается
дескриптором и одной строкой в реестре, механизм диалектов работает. Если для него потребовалось
править исходники Mastodon — механизм не работает, и это надо чинить до третьего форка, а не
после.

Официальные источники: [Pixelfed API](https://docs.pixelfed.org/technical-documentation/api/),
[Mastodon statuses](https://docs.joinmastodon.org/methods/statuses/).

### Truth Social

Технически — то же самое, что Pixelfed: форк Mastodon с совместимым API, то есть дескриптор
поверх `platform-mastodon`, а не новый код.

**Блокирующее условие не инженерное.** Пакет не выпускается, пока не подтверждено, что
автоматическая публикация разрешена условиями использования сервиса и что доступ к API получен
законным путём и документирован. Это должно быть решено и записано **до** начала работы, а не
обнаружено при выпуске: объём кода здесь такой маленький, что соблазн «сделать сначала, спросить
потом» максимален, а цена ошибки — та же, что у любой другой сети.

Если подтверждения нет, правильный исход — профиль в каталоге со статусом `restricted` и
причиной. Каталог для того и существует.

### Dailymotion

Простая видео-сеть, форма которой уже дважды оплачена YouTube и Vimeo. Загрузка трёхшаговая:
получить upload URL, отправить файл, затем создать видео, сославшись на полученный URL.
Обработка асинхронная — `processing` + `checkStatus()`, как у остальных видео-сетей.
`title` обязателен.

Только `VIDEO`. Ни текста, ни изображений, ни галерей, ни Stories. `SHORT_VIDEO` отдельного
endpoint-а не имеет: вертикальное видео — обычная загрузка, как у YouTube, и итоговая
классификация остаётся за платформой.

Проблемы: доступ и лимиты зависят от статуса аккаунта (партнёрский/верифицированный); квоты на
число загрузок в сутки; удаление и правка есть, но в scope не входят.

Этот адаптер намеренно ставится последним среди видео-сетей: он ничего не проверяет в ядре и
существует ради полноты набора. Если сроки поджимают, переносится без ущерба для остальных.

Официальные источники: [Upload videos](https://developers.dailymotion.com/guides/upload-videos/),
[API reference](https://developers.dailymotion.com/api/).

### LinkedIn

По модели ложится лучше, чем большинство набора: публикация — один `POST` в Posts API с текстом,
и опционально ссылкой на уже загруженное медиа. Изображения и видео загружаются заранее
(`initializeUpload` → загрузка байт → ссылка на URN в посте) — знакомый двухшаговый цикл,
механика для которого уже есть.

Три особенности, которых нет больше нигде в наборе:

1. **`DOCUMENT` — настоящий публикуемый формат.** PDF-карусель у LinkedIn это полноценный тип
   поста, а не вложение. Это единственная сеть, где медиа-тип `document` из модели BloggerDog
   становится типом публикации, а не файлом рядом с текстом. `PostType.DOCUMENT` в ядре уже есть.
2. **Автор — участник или организация, и это разные права.** Пост от лица человека и пост от
   лица страницы компании отличаются не только `author` URN, но и продуктом доступа. Для
   BloggerDog интересен в первую очередь второй вариант, и он же сложнее в получении.
3. **Нативных статей через API нет.** Длинные материалы LinkedIn пишутся в собственном
   редакторе, публичного endpoint-а для них нет. `ARTICLE` объявляется `unsupported`, и здесь это
   особенно важно проговорить: у сети _есть_ статьи как продукт, поэтому пользователь будет
   ожидать поддержки. Отсутствие возможности — не то же самое, что отсутствие формата.

**Главный риск — доступ, а не код.** В каталоге профиль помечен `restricted`: публикация от лица
участника и от лица организации требует одобренных LinkedIn продуктов и scopes. Заявка подаётся
**до** начала работы над пакетом (см. решение 6 в «Продуктовых решениях»); без подтверждённого
доступа пакет не выпускается, каким бы готовым ни был код.

Проблемы: версионирование API задаётся заголовком и меняется по расписанию, версию нужно
фиксировать константой как у Meta; лимиты на число постов зависят от типа сущности;
`visibility` и настройки комментариев — платформенные значения, не общие; медиа обрабатывается
асинхронно и до готовности пост создавать нельзя.

Официальные источники:
[Posts API](https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api),
[Images API](https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api),
[Videos API](https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api),
[Documents API](https://learn.microsoft.com/linkedin/marketing/community-management/shares/documents-api).

### WhatsApp Channels — отвергнуто, адаптер не планируется

Это единственный пункт запроса, который нельзя выполнить как есть, и лучше сказать прямо, чем
запланировать невыполнимую работу.

**Публичного документированного API для публикации обновлений в WhatsApp Channels нет.** Cloud
API покрывает переписку бизнеса с пользователем (шаблоны, сессионные сообщения), а не создание
записей в канале. В каталоге профиль уже помечен `unavailable` именно по этой причине, и
это правильное состояние.

Решение: WhatsApp Channels остаётся в каталоге как `unavailable` и попадает в список наблюдения,
а не в план реализации. Пересмотр — только при появлении официального endpoint создания
обновления канала со ссылкой на документацию Meta. Никакого обходного пути (веб-автоматизация,
неофициальные библиотеки, реверс протокола) в этой библиотеке не будет: он нарушает условия
использования, ломается без предупреждения и не может дать честный `capabilities`.

Если продукту нужна доставка в WhatsApp прямо сейчас, единственный легальный вариант —
рассылка через Cloud API по собственному списку получателей. Это другой продукт (переписка,
согласия, шаблоны, оплата за сообщение), и в контракт «создать публикацию» он не укладывается.
Отдельно и осознанно, а не под видом «ещё одной соцсети».

Источник: [WhatsApp Channels FAQ](https://faq.whatsapp.com/265055289421317),
[Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).

## Границы сервиса: что в набор не входит и почему

Вопрос «а стоит ли добавлять» полезнее решить один раз критерием, а не по каждой сети. Контракт
этой библиотеки: **создать долговечную адресуемую публикацию из подготовленного контента.**
Отсюда три условия. Сеть в scope, если:

1. у результата есть стабильный идентификатор и, как правило, публичный URL;
2. публикация обращена к аудитории, а не к конкретному собеседнику;
3. контент можно подготовить заранее, без интерактивной сессии.

Сеть, не проходящая любое из условий, ломает не адаптер, а модель: `PostRef`, `checkStatus()`,
снапшот публикации и планировщик у хоста перестают что-либо значить.

Отдельно от механики действует продуктовый фильтр: даже проходящая все три условия сеть не
добавляется, если автоматическая публикация в ней вредит пользователю или нарушает правила
площадки.

| Сеть                  | Условия     | Решение                                                   |
| --------------------- | ----------- | --------------------------------------------------------- |
| **Discord**           | 1 ✓ 2 ✓ 3 ✓ | **В наборе** — как канал анонсов, а не как «соцсеть».     |
| **Reddit**            | 1 ✓ 2 ✓ 3 ✓ | **Не делаем.** Механика подходит, продуктовый риск — нет. |
| **Snapchat**          | 1 ~ 2 ✓ 3 ✓ | **Не делаем.**                                            |
| **Twitch**            | 1 ✗ 2 ✓ 3 ✗ | **Не делаем.**                                            |
| **WhatsApp Channels** | —           | **Отвергнуто** — публичного API не существует.            |

### Reddit — не делаем

По механике Reddit подходит идеально: submission имеет URL, бывает text/link/image/video, у него
есть обязательный `title` — как раз тот случай, ради которого в ядре отдельное поле `title`, а не
только `body`. Тем не менее в набор он не входит, и причина продуктовая, а не техническая:

- автоматический постинг в сабреддиты, которыми ты не владеешь, — самый быстрый способ получить
  бан аккаунта и репутационную проблему у продукта. Безопасный сценарий сужается до собственного
  сабреддита, то есть до заметно меньшей аудитории, чем предполагает стоимость интеграции;
- правила и обязательный flair различаются от сабреддита к сабреддиту сильнее, чем что-либо ещё
  в списке. Отказ «до сетевого вызова» здесь принципиально невозможен без предварительного
  запроса правил, то есть каждая публикация — минимум два обращения и постоянно устаревающая
  валидация;
- условия доступа к API менялись резко и могут меняться снова.

Профиль остаётся в каталоге как справочные данные. Если сеть понадобится позже, `title`,
`resolveCapabilities()` (пункт 14) и составной `target` (пункт 12) уже будут готовы — то есть
решение обратимо и ничего в ядре под него держать не нужно.

### Snapchat — не делаем

Доступ к Public Profile API одобрительный и не самообслуживаемый; в каталоге профиль уже помечен
`restricted`. Единственный поддерживаемый формат — Story, то есть эфемерный контент: условие 1
выполняется в лучшем случае частично. Для продукта, который строится вокруг долговечных
публикаций с историей, это чужая модель.

### Twitch — не делаем, и это не вопрос приоритета

У Twitch нет endpoint-а «опубликовать материал»: продукт построен вокруг live-сессии, а видео
появляются как её производные. Условие 1 не выполняется (нет создаваемого объекта публикации),
условие 3 не выполняется (контент не готовится заранее, он транслируется). В каталоге это уже
зафиксировано формулировкой «нет general-purpose endpoint-а для загрузки постов».

Единственное, что от Twitch имело бы смысл, — уведомление «стрим начался» в других сетях. Но это
**чтение** чужого API и триггер, а не публикация; место такой функциональности — в BloggerDog как
источнике события, а не здесь.

### PeerTube — не сейчас, но кандидат номер один на следующую волну

Единственная отложенная сеть, которую стоит держать в виду: она сочетает две уже оплаченные
механики (per-instance хост из пункта 13 и resumable video-upload) и не требует ничего нового от
ядра. Ценность — независимая от корпораций площадка для видео. Причина отложить только одна:
основной набор уже закрыт, а аудитория меньше, чем у любой сети из него.

### Общий принцип, который стоит записать

Библиотека — не «интеграция со всем, что имеет API». Каждая добавленная сеть — это постоянные
издержки: отслеживание версий API, поддержание `verifiedAt`, обновление дескрипторов, smoke-тесты
на живых аккаунтах и ответы пользователям, почему у одной сети нет того, что есть у другой. Сеть
добавляется, когда проходит три условия выше, не создаёт продуктового риска **и** есть
пользователь, который её просил. Каталог существует именно для того, чтобы «мы знаем про эту
сеть» не означало «мы её поддерживаем».

### Что проверка будущими сетями дала ядру

Разбор Dailymotion, PeerTube, Pixelfed и Truth Social делался как проверка расширяемости, и
результат стоит зафиксировать отдельно от их судьбы: **ни одна из четырёх не потребовала нового
понятия в ядре сверх пунктов 13 (`apiBaseUrl`) и 22 (диалекты API).** Это подтверждает, что
список изменений ядра конечен, а не растёт с каждой новой сетью.

Самое наглядное следствие — Pixelfed и Truth Social. Если пункт 22 сделан, каждая из них — это
дескриптор возможностей и строка в реестре. Если пункт 22 **не** сделан, каждая из них — копия
пакета Mastodon, и через год копий три и они разъехались. Это главный аргумент за то, чтобы
сделать пункт 22 до Mastodon, а не после.

## Порядок реализации

Детальный инженерный план работ по ядру (этапы, файлы, сигнатуры, ломающие изменения, чеклист
готовности) вынесен в отдельный документ: [PLAN-CORE-RU.md](./PLAN-CORE-RU.md). Здесь остаётся
только сквозной порядок.

Обратная совместимость со старым публичным API **не сохраняется**: легаси, фолбэки и алиасы не
оставляются, потребитель `../bloggerdog` переписывается под новый контракт после доработки
библиотеки, а не наоборот.

Порядок не по важности сети, а по тому, что каждый шаг проверяет в ядре. Дешёвые адаптеры
намеренно стоят между дорогими: они дают рабочий результат, пока идёт получение доступов к
сетям с review.

**Ядро (до первого нового адаптера)**

1. Расширить core типом `shortVideo`, моделью `ArticleDocument`, точными media/video rules,
   multipart helpers и безопасным async/resume contract; обновить conformance suite.
2. **Изменения ядра под весь набор (пункты 12–23), пока адаптер один.** Структурный `target`,
   `apiBaseUrl` в аккаунте, `resolveCapabilities()`, транспорт медиа push/pull, дженерик `extra`,
   реестр имён типов, тип `thread`, `adaptedRequest` в preview, quota-модель, механизм диалектов,
   per-instance OAuth client и заглушка `edit()`. Это единственный момент, когда такие правки
   стоят один рефакторинг вместо пятнадцати.
3. Исправить platform catalog только подтверждёнными официальными значениями и отдельными
   `verifiedAt`; не использовать generic media limits как обещание реализации.

**Параллельно с шагом 1, а не после него:** подать заявки на доступ к TikTok, X и LinkedIn и
запросить подтверждение условий по Truth Social. Сроки здесь измеряются неделями, и это
единственная зависимость, которую нельзя ускорить кодом (см. решение 6).

**Адаптеры**

4. `platform-discord` — первым. Один `POST`, без OAuth и без асинхронной обработки: проверяет
   сквозной путь через уже переделанное ядро на минимальном коде и даёт BloggerDog рабочую
   вторую сеть в первую же неделю. Заодно проверяет две модели auth внутри одной сети.
5. `platform-youtube` — проверяет resumable upload и processing contract.
6. Container-based `platform-threads` и `platform-instagram`, переиспользуя только внутренние
   source-файлы, без runtime package dependency между адаптерами.
7. `platform-facebook` с атомарным учётом partial unpublished media.
8. `platform-mastodon` — приёмочный тест федеративной модели: `apiBaseUrl`,
   `resolveCapabilities()` из `/api/v1/instance`, per-instance OAuth client, треды и
   `Idempotency-Key`. **Сразу же** вывести из него дескрипторы `pixelfed` и (при полученном
   подтверждении) `truthSocial` через механизм пункта 22 — именно это доказывает, что механизм
   работает, а не просто существует. Если для них потребовалось править исходники Mastodon,
   пункт 22 не сделан и дальше идти нельзя.
9. `platform-bluesky` с отдельно протестированным построением `facets` по UTF-8-байтам и
   счётчиком графем.
10. `platform-linkedin` — как только подтверждён доступ к нужному продукту. Даёт `document` как
    публикуемый тип и разделение «участник против организации».
11. `platform-tiktok` вместе с dynamic creator-info validation и обязательным UX-контрактом для
    host.
12. `platform-x` и `platform-pinterest`, проверив актуальные product access и media upload
    versions непосредственно перед кодированием.
13. `platform-vimeo` и `platform-dailymotion` — последними. Обе переиспользуют resumable-механику
    YouTube и ничего нового в ядре не проверяют; расхождения — протокол tus у Vimeo и квота
    хранилища вместо суточной квоты операций.

**Обвязка**

14. Для каждого пакета: README, auth validator, capabilities с official sources, HTTP/error layer,
    adapter, recorded fixtures, unit tests, conformance tests и workerd tests.
15. Подключить пакеты в root tsconfig/publish scripts/server Docker workspace и `PLATFORMS`,
    обновить `.env.example`, `config.yaml`, OAuth docs, examples, permanent platform matrix,
    `docs/PLATFORM-SPECIFICS.md` и `docs/CHANGELOG.md`.
16. Провести согласованные изменения на стороне BloggerDog: `CredentialProvider` поверх БД с
    `onCredentialsRefreshed`, отображение prisma `PostType` → библиотечный `type`, составной
    target, срок жизни подписанных media-URL и окно ожидания обработки на сеть
    (см. «Что сломается при добавлении основных сетей»). Без этого половина набора не заработает
    у единственного потребителя, каким бы правильным ни был адаптер.
17. Выполнить `pnpm validate`; перед выпуском — `pnpm validate:all`, sandbox accounts и ручные
    smoke tests каждого поддержанного content flow.

Контрольная точка после шага 2: описать Mastodon и Bluesky на бумаге и убедиться, что обе
ложатся без изменений ядра — свой хост инстанса, динамические лимиты, треды, idempotency key,
alt text, чужая единица счёта текста, не-OAuth2 аутентификация. Если не ложатся, ядро ещё не
готово, и это дешевле узнать до шага 5, чем после восьмого адаптера.

Контрольная точка после шага 8: `pixelfed` получен без единой правки в исходниках Mastodon.

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






----


Пошаговый план по группам - правильный

Группа 0 — «сквозной путь» (1 сеть)
discord
Один POST, multipart/form-data, без OAuth, без асинхронной обработки. Проверяет: что переделанное ядро вообще работает end-to-end на новом адаптере; две модели auth внутри одной сети (webhook = auth+target в одном секрете, и bot token с составным target — пункт 12); динамическую capability (лимит вложения от boost-уровня — пункт 14) на самом дешёвом коде.
Выход группы: BloggerDog получает вторую рабочую сеть в первую же неделю.

Группа 1 — resumable video upload + processing (3 сети)
youtube → vimeo → dailymotion
Общая механика: init → чанки по offset → finalize → processing → checkStatus(). Проверяет runChunkedUpload(), ResumeHandle без секретов, окно ожидания на сеть, quota-модель (пункт 20: YouTube — quota units, Vimeo — объём хранилища, и это разные сообщения пользователю). Vimeo добавляет только tus-заголовки, Dailymotion — только трёхшаговый порядок.
Отличие от порядка в документе: там Vimeo и Dailymotion стоят последними (13). Предлагаю делать их сразу за YouTube — пока механика в голове и в коде, они стоят по дню каждый; вынесенные в конец, они стоят повторного погружения.

Группа 2 — container-based Meta (3 сети)
threads → instagram → facebook
Общая механика: создать контейнер → дождаться готовности медиа → publish; pull-транспорт (Meta сама тянет байты по публичному URL — пункт 15); Graph API version константой; container expiry и защита от повторного publish. Threads первым как самый простой из трёх, Facebook последним — у него четыре разных flow и частичные артефакты при сбое галереи.
Общий код переиспользуетсясимостью между пакетами.

Группа 3 — федеративные, per-instance (1 пакет → 3 имени)
mastodon → из него дескрипторами pixelfed и (при подтверждённых ToS) truthSocial
Приёмочный тест федеративнунте (13),resolveCapabilities() из /api/v1/instance (14), per-instance OAuth client (23), треды (18), Idempotency-Key, alt text.
Жёсткий гейт: если для Pixики Mastodon — механизмдиалектов (22) не сделан, и дальше идти нельзя.

Группа 4 — не-OAuth и своя единица счёта (1 сеть)
bluesky
Стоит отдельной группой, потому что не делит механику ни с чем: клиент сам строит
запись лексикона, facets ст — в графемах. Этоотдельный тестируемый компонент, а не деталь сериализации. Плюс аутентификация не
OAuth2 — проверяет, что IP

Группа 5 — gated access (3 сети)
linkedin → tiktok → x (+ pinterest)
Объединены не механикой, а, а доступ: одобренныепродукты LinkedIn, аудит TikTok-приложения, платный tier X. Заявки подаются до
группы 0, параллельно с доная зависимость, которуюнельзя ускорить кодом. Механически: LinkedIn даёт document как публикуемый тип и
разделение «участник vs орьный Creator Info передкаждым постом с cacheableForSecs: 0; X — weighted character count через bodyLengthRule.urlWeight; Pinterest — составной target (board + section) и обязательный cover для video Pin.

Две контрольные точки

- После группы 0: описать и убедиться, что обе ложатся без изменений ядра. Дешевле узнать сейчас, чем на восьмом адаптере.
- После группы 3: pixelfedисходниках Mastodon.

Чем это отличается от «Пор

Порядок в PLAN-PLATFORMS-RU.md (шаги 4–13) по сути тот же, но перемешан: Vimeo/Dailymotion оторваны от YouTube, а gated-сети (TikTok, X, LinkedIn) вкраплены между самообслуживаемыми, из-за чего срыв заявки останавливает конвейер. Предлагаемая группировка чинит ровно эти два места. Если согласен — могу переписать раздел «Порядок реализации» в документе под группы.



Как предлагаю разложить - в ../bloggerdog

Волна A — вместе с группой 0 (Discord), после заморозки ядра.
Минимум, чтобы одна новая сеть реально заработала: составной target вместо { channelId, apiKey }, отображение prisma PostType → библиотечный type (иначе SHORT/STORY не доезжают), хранение webhook-секрета как секрета. Это же — первая настоящая проверка нового контракта живым потребителем, а не conformance-сьютом.

Волна B — перед группой 1 (YouTube), это же перед первым OAuth.
Модель токенов в БД + CredentialProvider + onCredentialsRefreshed + обработка AUTH_REFRESH_REQUIRED как «канал требует переавторизации», а не как ошибки публикации. Плюс окно ожидания обработки на сеть вместо глобальных MAX_STATUS_CHECKS = 30 / 15 минут — YouTube штатно выходит за 15 минут, без этого он будет «падать» на каждом длинном видео.

Волна C — перед группой 2 (Meta).
Срок жизни подписанных media-URL: токен выпускается в момент публикации, а не замораживается в preparedPayload, и живёт не меньше urlMustRemainAvailableForSecs. Для Telegram это незаметно, для pull-based Meta это провал публикации. Раньше волны C делать бессмысленно — нет ни одной pull-сети.

Волна D — в конце, разом.
Тут «потом» действительно правильно: неймспейсированный platformOptions вместо плоского extra (коллизии начинаются на пятнадцати сетях, а не на трёх) и выпиливание собственных форматтеров в пользу adaptedRequest из preview().

Практический критерий

Правило, по которому решать в спорных случаях: правка идёт в BloggerDog в тот момент, когда без неё первая сеть соответствующей группы не работает у живого пользователя. Всё, что не проходит этот тест, — в волну D.
