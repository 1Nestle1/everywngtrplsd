// Справочник игры: предметы, растения, исследования и функции API дрона.
// Всё, что видно игроку в «Справке» и в автодополнении, описано здесь.

export const ITEMS = ["Biomass", "Silicon", "Spores", "Gems", "Crystal", "Power", "Water", "Nanites", "Gold"] as const;
export type Item = (typeof ITEMS)[number];

export const ITEM_INFO: Record<Item, { ru: string; color: string }> = {
  Biomass: { ru: "Биомасса", color: "#7be08a" },
  Silicon: { ru: "Кремний", color: "#7fd8ff" },
  Spores: { ru: "Споры", color: "#ff9a5c" },
  Gems: { ru: "Самоцветы", color: "#c69bff" },
  Crystal: { ru: "Кристаллы", color: "#ff6fae" },
  Power: { ru: "Энергия", color: "#ffd84a" },
  Water: { ru: "Лёд", color: "#9fd2ff" },
  Nanites: { ru: "Наниты", color: "#b8c4d6" },
  Gold: { ru: "Золото", color: "#ffc247" },
};

export const ENTITIES = [
  "Moss", "Shard", "Pillar", "Fungus", "Geode", "Dead_Geode", "Solar", "Prism", "Hedge", "Treasure",
] as const;
export type Entity = (typeof ENTITIES)[number];

export const GROUNDS = ["Rock", "Dust"] as const;
export type Ground = (typeof GROUNDS)[number];

export const DIRECTIONS = ["North", "East", "South", "West"] as const;
export type Dir = (typeof DIRECTIONS)[number];

export interface PlantSpec {
  ru: string;
  grow: number; // секунд до созревания без воды
  ground: Ground[];
  cost: Partial<Record<Item, number>>;
  yields: Item | null;
  unlock: string; // какое исследование открывает
  note: string;
}

export const PLANTS: Partial<Record<Entity, PlantSpec>> = {
  Moss: { ru: "Мох", grow: 0.6, ground: ["Rock"], cost: {}, yields: "Biomass", unlock: "start",
    note: "Сам вырастает на голом камне. Даёт биомассу." },
  Shard: { ru: "Осколок", grow: 4, ground: ["Rock", "Dust"], cost: {}, yields: "Silicon", unlock: "plant",
    note: "Кристаллический куст. Даёт кремний." },
  Pillar: { ru: "Столп", grow: 7, ground: ["Rock", "Dust"], cost: {}, yields: "Silicon", unlock: "pillars",
    note: "Даёт 5 кремния, но растёт вдвое дольше за каждый соседний столп." },
  Fungus: { ru: "Грибница", grow: 5, ground: ["Dust"], cost: { Biomass: 1, Silicon: 1 }, yields: "Spores", unlock: "fungus",
    note: "Растёт только на пыли (till). Даёт споры." },
  Geode: { ru: "Жеода", grow: 3, ground: ["Dust"], cost: { Spores: 1 }, yields: "Gems", unlock: "geodes",
    note: "20% созревших трескаются. Квадрат k×k из целых жеод сливается и даёт k³ самоцветов." },
  Solar: { ru: "Солнечник", grow: 4, ground: ["Dust"], cost: { Spores: 1 }, yields: "Power", unlock: "solar",
    note: "measure() — число лепестков (7–15). Срезать цветок с максимумом лепестков при ≥10 цветках — 8 энергии." },
  Prism: { ru: "Призма", grow: 1.5, ground: ["Dust"], cost: { Gems: 1 }, yields: "Crystal", unlock: "prisms",
    note: "measure() — размер 0–9. Если связная группа отсортирована (восток и север не меньше), даёт n² кристаллов." },
};

export interface UnlockSpec {
  id: string;
  ru: string;
  desc: string;
  requires: string[];
  costs: Partial<Record<Item, number>>[]; // по уровням
}

export const UNLOCKS: UnlockSpec[] = [
  { id: "loops", ru: "Циклы", desc: "while, break, continue. Дрон работает, пока вы его не остановите.", requires: [],
    costs: [{ Biomass: 5 }] },
  { id: "expand", ru: "Расширение", desc: "Больше поле. Первый уровень даёт move() и направления North/East/South/West.", requires: ["loops"],
    costs: [{ Biomass: 12 }, { Biomass: 40, Silicon: 10 }, { Silicon: 50, Spores: 10 }, { Silicon: 150, Spores: 50 }, { Gems: 120, Crystal: 30 }] },
  { id: "speed", ru: "Скорость", desc: "Дрон выполняет действия быстрее.", requires: ["loops"],
    costs: [{ Biomass: 20 }, { Biomass: 60, Silicon: 10 }, { Silicon: 60 }, { Silicon: 150, Spores: 40 }, { Gems: 150 }] },
  { id: "plant", ru: "Посадка", desc: "plant(Entities.Shard) — осколки дают кремний.", requires: ["expand"],
    costs: [{ Biomass: 25 }] },
  { id: "senses", ru: "Сенсоры", desc: "if/elif/else, сравнения, get_entity_type(), can_harvest(), get_pos_x() и другие датчики.", requires: ["plant"],
    costs: [{ Biomass: 50 }] },
  { id: "variables", ru: "Переменные", desc: "Присваивание, арифметика + - * / // % и циклы for … in range().", requires: ["senses"],
    costs: [{ Silicon: 20 }] },
  { id: "pillars", ru: "Столпы", desc: "plant(Entities.Pillar) — по 5 кремния, но не любят соседей.", requires: ["senses"],
    costs: [{ Silicon: 25, Biomass: 50 }] },
  { id: "functions", ru: "Функции", desc: "def, return и import других файлов.", requires: ["variables"],
    costs: [{ Silicon: 50 }] },
  { id: "fungus", ru: "Грибница", desc: "till() превращает камень в пыль. На пыли растёт грибница — споры.", requires: ["variables"],
    costs: [{ Silicon: 50, Biomass: 80 }] },
  { id: "watering", ru: "Полив", desc: "use_item(Items.Water) ускоряет рост до 5 раз. Лёд копится сам.", requires: ["fungus"],
    costs: [{ Silicon: 60, Spores: 10 }] },
  { id: "lists", ru: "Списки", desc: "Списки [], кортежи (), словари {}, индексы и методы append/pop.", requires: ["variables"],
    costs: [{ Spores: 20 }] },
  { id: "geodes", ru: "Жеоды", desc: "Жеоды сливаются в гигантские. Квадрат k×k даёт k³ самоцветов.", requires: ["fungus"],
    costs: [{ Spores: 40, Silicon: 80 }] },
  { id: "solar", ru: "Солнечники", desc: "measure() и энергия: при запасе энергии дрон работает вдвое быстрее.", requires: ["geodes"],
    costs: [{ Spores: 60, Gems: 30 }] },
  { id: "prisms", ru: "Призмы", desc: "swap(dir) и measure(). Отсортируйте призмы — получите n² кристаллов.", requires: ["geodes"],
    costs: [{ Gems: 80 }] },
  { id: "maze", ru: "Лабиринт", desc: "use_item(Items.Nanites, n) на созревшем осколке выращивает лабиринт с сокровищем.", requires: ["prisms"],
    costs: [{ Gems: 150, Crystal: 40 }] },
  { id: "beacon", ru: "Маяк колонии", desc: "Финал: запустить маяк и вызвать колонистов.", requires: ["maze", "solar"],
    costs: [{ Gold: 200, Power: 30, Crystal: 100 }] },
];
export const UNLOCK_BY_ID = new Map(UNLOCKS.map((u) => [u.id, u]));

/** Размер поля по уровню расширения. */
export const WORLD_SIZES = [1, 3, 4, 6, 8, 10];
/** Множитель скорости по уровню. */
export const SPEEDS = [1, 1.5, 2, 3, 4, 6];

export interface FnSpec {
  name: string;
  sig: string;
  unlock: string;
  ticks: number; // стоимость в тиках (200 = обычное действие)
  doc: string;
}

export const FUNCTIONS: FnSpec[] = [
  { name: "harvest", sig: "harvest()", unlock: "start", ticks: 200, doc: "Собрать урожай под дроном. Незрелое растение просто пропадёт. Возвращает True, если что-то собрано." },
  { name: "do_a_flip", sig: "do_a_flip()", unlock: "start", ticks: 400, doc: "Сделать сальто. Бесполезно, но красиво." },
  { name: "print", sig: "print(…)", unlock: "start", ticks: 100, doc: "Показать значения над дроном и в окне вывода." },
  { name: "move", sig: "move(dir)", unlock: "expand", ticks: 200, doc: "Сдвинуться на клетку: North, East, South, West. За краем поля дрон появляется с другой стороны." },
  { name: "get_world_size", sig: "get_world_size()", unlock: "expand", ticks: 1, doc: "Длина стороны поля." },
  { name: "plant", sig: "plant(entity)", unlock: "plant", ticks: 200, doc: "Посадить растение под дроном. Возвращает False, если нельзя (не та почва, нет ресурсов, клетка занята)." },
  { name: "can_harvest", sig: "can_harvest()", unlock: "senses", ticks: 1, doc: "True, если растение под дроном созрело." },
  { name: "get_entity_type", sig: "get_entity_type()", unlock: "senses", ticks: 1, doc: "Что растёт под дроном: Entities.… или None." },
  { name: "get_ground_type", sig: "get_ground_type()", unlock: "senses", ticks: 1, doc: "Почва под дроном: Grounds.Rock или Grounds.Dust." },
  { name: "get_pos_x", sig: "get_pos_x()", unlock: "senses", ticks: 1, doc: "Координата X дрона (0 — запад)." },
  { name: "get_pos_y", sig: "get_pos_y()", unlock: "senses", ticks: 1, doc: "Координата Y дрона (0 — юг)." },
  { name: "num_items", sig: "num_items(item)", unlock: "senses", ticks: 1, doc: "Сколько предмета на складе: num_items(Items.Biomass)." },
  { name: "get_time", sig: "get_time()", unlock: "senses", ticks: 1, doc: "Игровое время в секундах." },
  { name: "get_tick_count", sig: "get_tick_count()", unlock: "senses", ticks: 1, doc: "Сколько тиков потратила программа." },
  { name: "clear", sig: "clear()", unlock: "senses", ticks: 200, doc: "Очистить поле: камень, мох, дрон в (0, 0)." },
  { name: "till", sig: "till()", unlock: "fungus", ticks: 200, doc: "Перепахать клетку: камень ↔ пыль. Растение пропадает." },
  { name: "use_item", sig: "use_item(item, n=1)", unlock: "watering", ticks: 200, doc: "Использовать предмет на клетке: Items.Water (полив) или Items.Nanites (лабиринт)." },
  { name: "get_water", sig: "get_water()", unlock: "watering", ticks: 1, doc: "Влажность клетки от 0 до 1." },
  { name: "measure", sig: "measure(dir=None)", unlock: "solar|prisms", ticks: 1, doc: "Лепестки солнечника, размер призмы или позиция сокровища в лабиринте. С dir — соседняя клетка." },
  { name: "swap", sig: "swap(dir)", unlock: "prisms", ticks: 200, doc: "Поменять местами растение под дроном и соседнее." },
  { name: "can_move", sig: "can_move(dir)", unlock: "maze", ticks: 1, doc: "True, если в эту сторону нет стены." },
];
export const FN_BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));

/** Что открывает каждое исследование из перечислений. */
export const ENUM_UNLOCKS: Record<string, string> = {
  "Entities.Moss": "plant", "Entities.Shard": "plant", "Entities.Pillar": "pillars", "Entities.Fungus": "fungus",
  "Entities.Geode": "geodes", "Entities.Dead_Geode": "geodes", "Entities.Solar": "solar", "Entities.Prism": "prisms",
  "Entities.Hedge": "maze", "Entities.Treasure": "maze",
  "Grounds.Rock": "senses", "Grounds.Dust": "senses",
  "Items.Biomass": "senses", "Items.Silicon": "senses", "Items.Spores": "senses", "Items.Gems": "senses",
  "Items.Crystal": "senses", "Items.Power": "senses", "Items.Water": "watering", "Items.Nanites": "maze", "Items.Gold": "senses",
  North: "expand", East: "expand", South: "expand", West: "expand",
};

/** Конструкции языка и исследования, которые их открывают. */
export const LANG_UNLOCKS: { feature: "loops" | "ifs" | "cmp" | "vars" | "ops" | "defs" | "imports" | "lists"; unlock: string; ru: string }[] = [
  { feature: "loops", unlock: "loops", ru: "Циклы while/for" },
  { feature: "ifs", unlock: "senses", ru: "Условия if" },
  { feature: "cmp", unlock: "senses", ru: "Сравнения" },
  { feature: "vars", unlock: "variables", ru: "Переменные" },
  { feature: "ops", unlock: "variables", ru: "Арифметика" },
  { feature: "defs", unlock: "functions", ru: "Функции def" },
  { feature: "imports", unlock: "functions", ru: "import" },
  { feature: "lists", unlock: "lists", ru: "Списки и кортежи" },
];
