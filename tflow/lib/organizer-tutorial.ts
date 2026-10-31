export type GuideAction =
  | "create"
  | "schedule"
  | "program"
  | "preview"
  | "participants"
  | "entry"
  | "overview";

export const ORGANIZER_LESSONS = [
  {
    label: "Черновик",
    title: "Начните с черновика",
    description:
      "Сначала подготовьте событие в своём кабинете. Участники увидят его после публикации.",
    tips: [
      "Нажмите «Создать событие», укажите название и категорию.",
      "Выберите формат: очно, онлайн или гибрид. Для онлайн-встречи вебинар уже встроен в ТФлоу.",
      "Сохраните черновик — его можно спокойно дополнять и проверять.",
    ],
    action: "create",
    actionLabel: "Создать черновик",
  },
  {
    label: "Время и место",
    title: "Запланируйте встречу",
    description:
      "Укажите общие границы мероприятия: когда оно начинается, когда заканчивается и где проходит.",
    tips: [
      "Время на сайте указано по Москве — учитывайте это, если проводите встречу в другом городе.",
      "Для очного события укажите площадку и адрес. Для онлайн-события участники подключатся внутри ТФлоу.",
      "Время и место можно изменить в «Программе». При переносе начала пункты программы сдвинутся вместе с событием.",
    ],
    action: "schedule",
    actionLabel: "Настроить время и место",
  },
  {
    label: "Программа",
    title: "Составьте программу по времени",
    description:
      "Разбейте встречу на понятные этапы: открытие, лекция, практикум или обсуждение.",
    tips: [
      "Откройте «Программа» → «Добавить пункт». Название и время заполняются прямо в блоке флоу.",
      "Для каждого пункта укажите название, начало, окончание и аудиторию. «Онлайн» — один вебинар, который может идти параллельно очным залам. Спикер и описание необязательны.",
      "Флоу идёт сверху вниз по времени; текущие активности выделены. Для перетягивания и растягивания пунктов включите «Шкала времени». Пересечения проверяются при сохранении.",
    ],
    action: "program",
    actionLabel: "Открыть программу",
  },
  {
    label: "Публикация",
    title: "Проверьте и опубликуйте",
    description:
      "Посмотрите, как выглядит страница для участника, прежде чем открывать регистрацию.",
    tips: [
      "Откройте «Страница участника» и проверьте название, время, место и программу.",
      "Вернитесь в управление событием и нажмите «Опубликовать» — событие появится в каталоге.",
      "Поделитесь ссылкой на страницу события. При переносе или отмене записавшиеся участники получат уведомление на сайте.",
    ],
    action: "preview",
    actionLabel: "Открыть страницу участника",
  },
  {
    label: "Участники",
    title: "Подготовьте работу с участниками",
    description:
      "Все записавшиеся собраны во вкладке «Участники». Там же можно настроить сведения, нужные при записи.",
    tips: [
      "Откройте «Участники» → «Что спросить при записи» → «Настроить».",
      "Имя и почта уже есть. Запрашивайте телефон, город и другие поля только тогда, когда они нужны для вашей встречи.",
      "Используйте поиск и фильтры, чтобы найти человека, посмотреть анкету и проверить отметку на входе.",
    ],
    action: "participants",
    actionLabel: "Открыть участников",
  },
  {
    label: "Проведение",
    title: "Встречайте гостей или начните эфир",
    description:
      "Всё готово к проведению: для очной встречи есть проверка QR, для онлайн-встречи — студия вебинара.",
    tips: [
      "Очно: нажмите «Сканировать QR» и наведите камеру на QR-код профиля участника. ТФлоу проверит его регистрацию на выбранное событие.",
      "У участника один QR-код профиля для всех событий, на которые он записан.",
      "Онлайн: нажмите «Открыть студию», подготовьте камеру и микрофон и начните эфир. Зарегистрированные зрители войдут со страницы события.",
    ],
    action: "entry",
    actionLabel: "Перейти к проведению",
  },
] as const;

export type TutorialProgress = {
  step: number;
  started: boolean;
  dismissed: boolean;
  completed: boolean;
};
export const newTutorialProgress = (): TutorialProgress => ({
  step: 0,
  started: false,
  dismissed: false,
  completed: false,
});
export const tutorialStorageKey = (userId: string) =>
  `tflow-organizer-tutorial:v1:${userId}`;

export function readTutorialProgress(userId: string): TutorialProgress {
  try {
    const value = JSON.parse(
      localStorage.getItem(tutorialStorageKey(userId)) ?? "null",
    );
    if (
      !value ||
      !Number.isInteger(value.step) ||
      value.step < 0 ||
      value.step >= ORGANIZER_LESSONS.length
    )
      return newTutorialProgress();
    return {
      step: value.step,
      started: value.started === true,
      dismissed: value.dismissed === true,
      completed: value.completed === true,
    };
  } catch {
    return newTutorialProgress();
  }
}

export function saveTutorialProgress(
  userId: string,
  progress: TutorialProgress,
) {
  try {
    localStorage.setItem(tutorialStorageKey(userId), JSON.stringify(progress));
  } catch {
    /* Learning remains usable when browser storage is unavailable. */
  }
}
