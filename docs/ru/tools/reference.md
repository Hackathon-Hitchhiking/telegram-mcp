# Справочник инструментов

Telegram MCP Server предоставляет 194 инструмента, организованных по категориям. Все инструменты автоматически обнаруживаются через MCP.

## Аутентификация

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-status` | Проверка подключения и информация об аккаунте |
| `telegram-login` | Генерация QR-кода для аутентификации |
| `telegram-logout` | Отзыв сессии на серверах Telegram и удаление локального session-файла |

## Сообщения

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-message` | Отправка сообщения в любой чат (включая `quoteText` для цитаты фрагмента и Premium `effect` — анимированный эффект) |
| `telegram-edit-message` | Редактирование отправленного сообщения |
| `telegram-delete-message` | Удаление сообщений |
| `telegram-forward-message` | Пересылка сообщений между чатами |
| `telegram-send-scheduled` | Отложенная отправка сообщения |
| `telegram-send-typing` | Индикатор «печатает…» / «загружает файл» |
| `telegram-translate-message` | Перевод одного или нескольких сообщений (требуется Premium; расходует квоту переводов) |
| `telegram-get-message-link` | Получить публичную t.me-ссылку на сообщение |

## Нативные Rich Messages (локальное расширение)

Семь инструментов работают через личный аккаунт с нативными блоками Telegram, включая настоящие таблицы. `parseMode: "md"` в обычном сообщении форматирует текст; для нативной таблицы нужны rich-инструменты.

| Инструмент | Описание |
|------|-------------|
| `telegram-preview-rich-message` | Локально скомпилировать `markdown`, проверить текст, заголовки/ячейки таблиц и ограничения; без подключения и отправки |
| `telegram-rich-message-capabilities` | Проверить слой схемы, Premium аккаунта и серверный режим `rich_message_posting` |
| `telegram-send-rich-message` | Отправить нативные rich-блоки с постоянным UUID v4 `requestId` |
| `telegram-edit-rich-message` | Заменить rich-содержимое точного сообщения по `chatId` / `messageId` |
| `telegram-save-rich-draft` | Сохранить rich-черновик с необязательным ответом/топиком |
| `telegram-get-rich-message` | Прочитать точное сообщение, текст и таблицы; отметить частичные или неподдерживаемые данные |
| `telegram-get-rich-send-status` | Прочитать локальную квитанцию по `requestId`; без отправки и повторов |

Сначала используйте предпросмотр и проверку возможностей. Отправка требует допуска сервера (обычно Premium) и прав в чате; сама установка их не подтверждает. Компилятор поддерживает таблицы, заголовки, абзацы, плоские списки/чек-листы, цитаты, блоки кода с ограждением, ссылки и строчные стили. Вложенные списки, сноски и математические выражения отклоняются. Локальные пределы: 128 КиБ исходника UTF-8, 32 768 отображаемых символов, 500 блоков, глубина 16 и 20 столбцов таблицы. Сервер дополнительно применяет свои ограничения. Автоматической отправки текстовой замены нет.

Для записи нужны `chatId`, `markdown` и новый UUID v4 `requestId`; для редактирования также `messageId`. Повтор с тем же содержимым возвращает сохранённую квитанцию; изменение чата, операции, текста или параметров отклоняется. Квитанции находятся в `rich-message-operations` рядом с session-файлом. Состояния `submitting` и `uncertain` нужно проверять через статус и чтение точного сообщения/истории. Не удаляйте квитанцию и не создавайте новый ID для слепой повторной отправки. После принятой немедленной отправки/правки выполняется чтение по точному peer/ID; `verified` означает совпадение полного поддерживаемого текста, таблиц, явных ссылок, стилей и нормализованной нативной структуры. Чтение также возвращает ограниченное дерево `semanticStructure` и диагностические имена конструкторов `semanticUnsupported`. Для отложенного сообщения сохраняется подтверждённый ID без заявления о доставке или немедленной проверке. Черновик подтверждается без чтения сообщения. Отправка принимает `silent`, `protectContent`, `clearDraft`, `replyTo`, `topicId`, `scheduleDate`, `rtl`, `noautolink`; правка — последние два, черновик — также ответ/топик.

## Точное чтение и каталог API (локальное расширение)

| Инструмент | Описание |
|------|-------------|
| `telegram-get-messages-by-id` | Прочитать 1–100 различных ID из точного чата в заданном порядке; отметить отсутствующие/недоступные |
| `telegram-get-history-page` | Получить одну страницу от новых к старым с `offsetId`, `offsetDate`, знаковым `addOffset`, `minId`, `maxId`, `limit` |
| `telegram-search-sent-media` | Искать недавно отправленные медиа по всем чатам; до 100 результатов, без пагинации |
| `telegram-api-search` | Искать методы/типы установленной TL-схемы по имени, результату или полю; с пагинацией |
| `telegram-api-describe` | Описать метод/конструктор TL: поля, типы, биты флагов и тип результата |

Это чтение не помечает сообщения прочитанными. Глобальные ID фильтруются по выбранному чату. Границы ID в истории исключающие; `nextOffsetId` — ID последней нативной строки, конец подтверждает только пустая страница. При продолжении с этим курсором сбросьте `addOffset`. Фильтры медиа: `photo`, `video`, `photoVideo`, `document`, `music`, `voice`, `gif`; сервер может отклонить неподдерживаемый фильтр. Текст ответов ограничен по объёму и не является полным экспортом.

Каталог использует установленную схему слоя 233 без подключения к Telegram. Он описывает протокол, включая поля без отдельного MCP-инструмента. Поиск/описание **не выполняют** произвольные методы и не предоставляют права. Имена полей — GramJS camelCase; индикаторами флагов управляет сериализатор.

## Форматирование обычного текста и параметры отправки

`telegram-send-message`, `telegram-edit-message`, `telegram-save-draft` принимают `entities`, `noWebpage`, `invertMedia`; правка/черновик также принимают `parseMode`. Сущность содержит `type`, `offset`, `length`; `url` допустим только для `text_url`, `language` — для `pre`. Типы: `bold`, `italic`, `underline`, `strike`, `spoiler`, `code`, `pre`, `text_url`. Смещения и длины считаются в кодовых единицах UTF-16 исходного текста; нельзя разрывать суррогатную пару. Максимум 100 сущностей. `entities` несовместим с `parseMode`. Допустимые схемы ссылок: http, https, mailto, tg.

Отправка дополнительно принимает `silent`, `background`, `clearDraft`, `protectContent` (MTProto `noforwards`), `scheduleDate`, `scheduleRepeatPeriod`, `sendAs`, `replyToPeer`, `quoteOffset`, а также `quoteText`, `effect`, `replyTo`, `topicId`. Время — будущая Unix-метка в секундах; повтор требует `scheduleDate`. `replyToPeer` требует `replyTo`; `quoteOffset` — `quoteText` и `replyTo`. Права, Premium-эффекты и повторное расписание проверяет сервер. У обычных записей нет постоянной rich-квитанции с `requestId`.

## Отложенные

| Инструмент | Описание |
|------------|----------|
| `telegram-get-scheduled` | Список отложенных сообщений в чате |
| `telegram-delete-scheduled` | Удалить одно или несколько отложенных сообщений |

## Чтение

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-list-chats` | Список чатов с фильтрами |
| `telegram-read-messages` | Чтение последних сообщений с пагинацией |
| `telegram-search-messages` | Поиск в конкретном чате по ключевым словам |
| `telegram-search-global` | Поиск по всем чатам сразу |
| `telegram-search-chats` | Поиск чатов по названию |
| `telegram-get-unread` | Чаты с непрочитанными сообщениями |
| `telegram-mark-as-read` | Отметить чат как прочитанный |
| `telegram-get-replies` | Чтение комментариев/реплаев к посту канала |
| `telegram-get-unread-mentions` | Непрочитанные упоминания в чате (помечает их прочитанными на сервере) |
| `telegram-get-unread-reactions` | Непрочитанные реакции на ваши сообщения (помечает их прочитанными на сервере) |
| `telegram-get-saved-dialogs` | Список «папок» внутри «Избранного» (Saved Messages) |

## Черновики

| Инструмент | Описание |
|------------|----------|
| `telegram-save-draft` | Сохранить текстовый черновик в чате (пустой — удаляет черновик) |
| `telegram-get-drafts` | Список всех чатов с сохранёнными черновиками |
| `telegram-clear-drafts` | Очистить черновик чата, либо все черновики во всех чатах (требуется `confirmAllChats: true`) |

## Топики форумов

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-list-topics` | Список топиков в форуме |
| `telegram-read-topic-messages` | Чтение сообщений из конкретного топика |
| `telegram-create-topic` | Создать новый топик |
| `telegram-edit-topic` | Переименовать, закрыть, скрыть или обновить топик |
| `telegram-delete-topic` | Удалить топик вместе с историей |

## Опросы

| Инструмент | Описание |
|------------|----------|
| `telegram-create-poll` | Создание опроса или викторины |

## Голосование в опросах (v1.31.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-vote-poll` | Проголосовать в опросе по индексу варианта. Пустой массив `optionIndexes: []` отзывает голос |
| `telegram-get-poll-results` | Получить сводные результаты: голоса, проценты, правильные ответы в викторинах |
| `telegram-get-poll-voters` | Список проголосовавших по варианту (только публичные опросы, с пагинацией) |
| `telegram-close-poll` | Закрыть опрос навсегда — необратимая операция |

## Реакции

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-reaction` | Поставить реакцию на сообщение |
| `telegram-get-reactions` | Получить реакции на сообщение |
| `telegram-set-default-reaction` | Задать реакцию по умолчанию для вашего аккаунта |
| `telegram-get-top-reactions` | Топовые (популярные) эмодзи-реакции Telegram |
| `telegram-get-recent-reactions` | Ваши недавно использованные реакции |

## Платные реакции (v1.31.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-paid-reaction` | Отправить ★ звёзды как платную реакцию на пост канала (`count` 1–2500, опциональный `private`) |
| `telegram-toggle-paid-reaction-privacy` | Переключить видимость в таблице лидеров для платной реакции на конкретный пост |
| `telegram-get-paid-reaction-privacy` | Получить текущую настройку приватности платных реакций по умолчанию |

## Транскрипция аудио (v1.31.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-transcribe-audio` | Запустить транскрипцию голосового/видео-сообщения (Telegram Premium). Возвращает `transcriptionId`; при `pending:true` — повторите `telegram-get-transcription` |
| `telegram-get-transcription` | Получить обновлённый статус транскрипции (идемпотентный вызов) |
| `telegram-rate-transcription` | Оценить качество транскрипции как хорошее или плохое |

## Проверка фактов (v1.31.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-fact-check` | Получить аннотации фактчекинга для до 100 сообщений канала |
| `telegram-edit-fact-check` | Добавить/обновить аннотацию фактчекинга (требуются привилегии фактчекера) |
| `telegram-delete-fact-check` | Удалить аннотацию фактчекинга (требуются привилегии фактчекера) |

## Стикеры

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-sticker` | Отправить стикер |
| `telegram-get-installed-stickers` | Список установленных стикерпаков |
| `telegram-get-recent-stickers` | Недавно использованные стикеры |
| `telegram-get-sticker-set` | Просмотр стикеров в паке |
| `telegram-search-sticker-sets` | Поиск стикерпаков |

## Медиа

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-file` | Отправка файла, фото или документа |
| `telegram-download-media` | Скачивание медиа из сообщения |
| `telegram-get-profile-photo` | Получение фото профиля |
| `telegram-get-web-preview` | Превью ссылки (заголовок/описание/сайт) перед отправкой |

## Rich Media (v1.29.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-voice` | Голосовое сообщение (OGG/Opus) — показывается с waveform UI |
| `telegram-send-video-note` | Видео-кружочек (MP4, квадратный, ≤60 сек) |
| `telegram-send-location` | Геопозиция — статичная либо live (параметр `livePeriod`, 60–86400 сек) |
| `telegram-send-venue` | Карточка места (title, address, координаты) |
| `telegram-send-contact` | Карточка контакта (phone, firstName, lastName, vCard) |
| `telegram-send-dice` | Анимированный dice/game (🎲🎯🎰🏀⚽🎳); возвращает значение броска |
| `telegram-send-album` | Альбом из 2–10 фото/видео в одном сообщении |

Все `filePath` принимают только абсолютные локальные пути. URL, UNC-шары, `..` и системные псевдо-директории (`/proc`, `/sys`, `/dev`, `/run`) отклоняются.

## Группы

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-create-group` | Создать группу |
| `telegram-edit-group` | Изменить название, описание, фото |
| `telegram-invite-to-group` | Пригласить в группу |
| `telegram-join-chat` | Вступить по инвайт-ссылке |
| `telegram-leave-group` | Покинуть группу |
| `telegram-kick-user` | Кикнуть пользователя |
| `telegram-ban-user` | Забанить пользователя |
| `telegram-unban-user` | Разбанить пользователя |
| `telegram-set-admin` | Назначить администратором |
| `telegram-remove-admin` | Снять права администратора |
| `telegram-get-my-role` | Проверить свою роль и права |
| `telegram-set-chat-permissions` | Установить права по умолчанию для всех участников (опущенные флаги сохраняют текущее значение) |
| `telegram-set-slow-mode` | Задать интервал медленного режима для супергруппы |
| `telegram-get-admin-log` | Журнал модерации/админ-событий |

## Информация о чатах

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-chat-info` | Подробная информация о чате |
| `telegram-get-chat-members` | Список участников группы/канала |
| `telegram-get-chat-folders` | Список папок чатов |

## Инвайт-ссылки

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-create-invite-link` | Создать ссылку-приглашение |
| `telegram-get-invite-links` | Список существующих ссылок |
| `telegram-revoke-invite-link` | Отозвать ссылку |

## Контакты

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-contacts` | Список контактов |
| `telegram-add-contact` | Добавить контакт |
| `telegram-get-contact-requests` | Входящие запросы на контакт |

## Модерация

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-block-user` | Заблокировать пользователя |
| `telegram-unblock-user` | Разблокировать пользователя |
| `telegram-report-spam` | Пожаловаться на спам |

## Профили

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-profile` | Информация о профиле пользователя |
| `telegram-get-saved-music` | Песни, закреплённые в профиле пользователя |
| `telegram-update-profile` | Обновить свой профиль (имя, био, username) |

## Аккаунт

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-sessions` | Список активных сессий (устройств) |
| `telegram-terminate-session` | Завершить сессию |
| `telegram-set-privacy` | Настройки приватности |
| `telegram-set-auto-delete` | Таймер автоудаления сообщений |

## Закрепление

| Инструмент | Описание |
|------------|----------|
| `telegram-pin-message` | Закрепить сообщение |
| `telegram-unpin-message` | Открепить сообщение |

## Настройки чата

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-mute-chat` | Замьютить или размьютить уведомления |
| `telegram-archive-chat` | Переместить чат в Архив или обратно |
| `telegram-pin-chat` | Закрепить или открепить диалог в списке чатов |
| `telegram-mark-dialog-unread` | Отметить диалог непрочитанным или снять пометку |

## Настройки администратора и кастомизация

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-toggle-channel-signatures` | Включить/выключить подписи постов в канале |
| `telegram-toggle-anti-spam` | Включить/выключить встроенный антиспам в супергруппе (админ с `ban_users`) |
| `telegram-toggle-forum-mode` | Включить/выключить режим форума (отключение удаляет все темы; требуется `confirm: true`) |
| `telegram-toggle-prehistory-hidden` | Скрыть или показать предысторию для новых участников супергруппы |
| `telegram-set-chat-reactions` | Настроить разрешённые реакции в чате (`all` / `some` / `none`) |
| `telegram-approve-join-request` | Одобрить или отклонить заявку на вступление |

## Статистика

| Инструмент | Описание |
|------------|----------|
| `telegram-get-broadcast-stats` | Статистика канала (`includeGraphs: true` для сырых графиков; может требоваться Premium-админ) |
| `telegram-get-megagroup-stats` | Статистика супергруппы (Telegram ограничивает до ~1 запроса/30 мин на канал) |

## Инлайн-боты и кнопки

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-inline-query` | Инлайн-запрос к боту в контексте чата (TTL queryId ≈ 1 мин) |
| `telegram-inline-query-send` | Отправить результат инлайн-бота по queryId + id результата |
| `telegram-press-button` | Нажать callback-кнопку на сообщении по row/col или raw data |
| `telegram-get-message-buttons` | Перечислить кнопки reply-markup сообщения с индексами и типами |

## Обновления в реальном времени (polling)

Курсоры хранятся на стороне клиента — агент сохраняет `{pts, qts, date}` между вызовами и передаёт их обратно.

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-state` | Инициализировать курсор опроса (`pts`, `qts`, `date`, `seq`) |
| `telegram-get-updates` | Получить глобальные обновления по известному курсору (на `DifferenceTooLong` возвращает подсказку про history) |
| `telegram-get-channel-updates` | Получить обновления конкретного канала по его курсору |

## Истории (Stories)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-all-stories` | Список историй по всем контактам с состоянием пагинации |
| `telegram-get-peer-stories` | Список историй одного пира |
| `telegram-get-stories-by-id` | Получить конкретные истории по id |
| `telegram-get-story-views` | Список просмотров ваших историй (для полной статистики нужен Premium) |

## Истории — запись (v1.30.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-send-story` | Опубликовать историю (фото или видео) с настройками приватности, сроком и флагами |
| `telegram-edit-story` | Редактировать историю: заменить медиа, обновить подпись или приватность |
| `telegram-delete-stories` | Удалить одну или несколько историй (необратимо; требует `confirm: true`) |
| `telegram-react-to-story` | Поставить реакцию на историю; `""` убирает реакцию |
| `telegram-export-story-link` | Получить ссылку `t.me/…` на публичную историю |
| `telegram-read-stories` | Отметить истории просмотренными до указанного ID |
| `telegram-toggle-story-pinned` | Закрепить/открепить истории в профиле |
| `telegram-toggle-story-pinned-to-top` | Прикрепить истории в верхнюю строку; `[]` очищает |
| `telegram-activate-stealth-mode` | Скрыть просмотры историй (требует Telegram Premium) |
| `telegram-get-stories-archive` | Получить архив истёкших историй с пагинацией |
| `telegram-report-story` | Пожаловаться на историю через многошаговый flow |

## Обсуждения (v1.30.0)

| Инструмент | Описание |
|------------|----------|
| `telegram-get-discussion-message` | Получить инфо о группе обсуждений для поста канала с комментариями |
| `telegram-get-groups-for-discussion` | Список групп, подходящих для привязки как группу обсуждений |

## Статусы прочтения (v1.30.0)

| Инструмент | Описание |
|------------|----------|
| `telegram-get-message-read-participants` | Кто прочитал сообщение в малой группе (≤100 чел., ≤7 дней) |
| `telegram-get-outbox-read-date` | Когда получатель прочитал ваше исходящее сообщение в личке |

## Профиль (запись, v1.32.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-set-emoji-status` | Установить эмодзи-статус рядом с именем (Premium). Передать `documentId` или `collectibleId`; пропустить оба = очистить |
| `telegram-list-emoji-statuses` | Список доступных статусов: `default`, `recent`, `channel_default`, `collectible` |
| `telegram-clear-recent-emoji-statuses` | Очистить список «недавних» эмодзи-статусов |
| `telegram-set-profile-color` | Цвет имени или фона профиля (Premium для index ≥ 7). `forProfile=false` = имя в чатах, `true` = фон профиля |
| `telegram-set-birthday` | Дата рождения (`day`, `month`; `year` необязателен). `clear=true` = удалить |
| `telegram-set-personal-channel` | Добавить канал на профиль. `clear=true` = убрать |
| `telegram-set-profile-photo` | Загрузить аватар (JPEG/PNG или MP4, квадратное, ≤10с). `fallback=true` = запасной аватар |
| `telegram-delete-profile-photo` | Удалить фото профиля по ID. Возвращает `deleted` и `missing` |

## Telegram Business (v1.32.0)

Требуется подписка **Telegram Business**, кроме отмеченных.

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-business-chat-links` | Список Business chat links (без подписки тоже работает) |
| `telegram-create-business-chat-link` | Создать ссылку `t.me/m/...` с предзаполненным сообщением |
| `telegram-edit-business-chat-link` | Изменить ссылку по slug |
| `telegram-delete-business-chat-link` | Удалить ссылку по slug |
| `telegram-resolve-business-chat-link` | Узнать чей чат откроет ссылка и предзаполненное сообщение |
| `telegram-set-business-hours` | Часы работы: `timezone` + массив `{day, openFrom, openTo}` в HH:MM. `clear=true` = убрать |
| `telegram-set-business-location` | Адрес ± геоточка. `clear=true` = убрать |
| `telegram-set-business-greeting` | Авто-ответ для новых чатов. `shortcutId` (из `get-quick-replies`), `audience`, `noActivityDays` |
| `telegram-set-business-away` | Авто-ответ при офлайне. `schedule`: `always`/`outside_hours`/`custom`. `clear=true` = убрать |
| `telegram-set-business-intro` | Карточка-приветствие: `title` (≤32) + `description` (≤70) + опциональный стикер |

## Бусты

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-get-my-boosts` | Список бустов, выданных вашим аккаунтом |
| `telegram-get-boosts-status` | Статус бустов канала/супергруппы |
| `telegram-get-boosts-list` | Список бустеров канала (админ) |

## Папки чатов (v1.33.0)

| Инструмент | Описание |
| ------------ | ---------- |
| `telegram-create-folder` | Создать папку чатов — целые категории через type-флаги или конкретные чаты |
| `telegram-edit-folder` | Изменить папку по ID; непереданные поля сохраняют текущие значения |
| `telegram-delete-folder` | Удалить папку по ID (чаты остаются в «Все чаты»; системные папки удалить нельзя) |
| `telegram-reorder-folders` | Изменить порядок папок, передав новый порядок ID |
| `telegram-toggle-folder-tags` | Включить/выключить теги папок — цветные метки в списке чатов (Premium) |
| `telegram-get-suggested-folders` | Получить предлагаемые Telegram шаблоны папок (например «Непрочитанные», «Личное», «Работа») |

## Глобальная приватность (v1.33.0)

| Инструмент | Описание |
|------------|----------|
| `telegram-get-global-privacy-settings` | Прочитать общеаккаунтные настройки: автоархив новых не-контактов, немьют архива, скрытие статусов прочтения, «писать могут только Premium» |
| `telegram-set-global-privacy-settings` | Обновить общеаккаунтные настройки приватности; непереданные поля не меняются (часть требует Premium) |

## Opt-in (по env-флагам)

Регистрируются только при выставленном флаге окружения.

| Инструмент | Env-флаг |
| ------------ | ---------- |
| `telegram-get-group-call` | `MCP_TELEGRAM_ENABLE_GROUP_CALLS=1` |
| `telegram-get-group-call-participants` | `MCP_TELEGRAM_ENABLE_GROUP_CALLS=1` |
| `telegram-get-stars-status` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-stars-transactions` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-stars-topup-options` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-stars-subscriptions` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-change-stars-subscription` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-available-star-gifts` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-saved-star-gifts` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-save-star-gift` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-convert-star-gift` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-quick-replies` | `MCP_TELEGRAM_ENABLE_QUICK_REPLIES=1` |
| `telegram-get-quick-reply-messages` | `MCP_TELEGRAM_ENABLE_QUICK_REPLIES=1` |

---

::: tip
Запоминать инструменты не нужно. Просто опишите, что хотите, естественным языком — ваш ИИ-ассистент выберет нужный инструмент автоматически.
:::
