// Подсказки игроку: пошаговые цели, учебник по языку, разовые советы
// и короткие пояснения ключевых слов для всплывающих подсказок в редакторе.

import type { World } from "./world";

export interface GuideStep {
  /** Навык, к которому ведёт шаг; null — после победы. */
  target: string | null;
  text: string;
  /** Пример кода для кнопки «Пример». */
  code?: string;
}

const COLUMN3 = (body: string[]) =>
  "while True:\n" + [0, 1, 2].map(() => body.map((l) => "    " + l).join("\n") + "\n    move(North)").join("\n") + "\n    move(East)";

/** Текущий шаг обучения: первый, чей навык ещё не изучен. */
export function currentGuide(w: World): GuideStep {
  if (w.won) return { target: null, text: "Маяк запущен, колонисты в пути. Можно и дальше оптимизировать код: быстрее, короче, красивее." };
  if (!w.has("loops"))
    return {
      target: "loops",
      text: "Нажмите «Запуск» или Ctrl+Enter: дрон выполнит harvest() и соберёт мох. Мох отрастает за полсекунды — запускайте снова, пока не наберёте 5 биомассы.",
      code: "harvest()",
    };
  if (!w.has("expand"))
    return {
      target: "expand",
      text: "Оберните harvest() в цикл while True: — дрон будет собирать сам, пока вы не нажмёте «Стоп». Строку внутри цикла сдвиньте клавишей Tab.",
      code: "while True:\n    harvest()",
    };
  if (!w.has("plant"))
    return {
      target: "plant",
      text: "Поле стало 3×3. Двигайте дрона после сбора: move(North) — вверх, move(East) — вправо. Поле закольцовано: за краем дрон появляется с другой стороны.",
      code: COLUMN3(["harvest()"]),
    };
  if (!w.has("senses"))
    return {
      target: "senses",
      text: "plant(Entities.Shard) сажает осколок на месте мха — он даёт кремний. Осколок зреет около 4 секунд, срезанный раньше пропадёт. «Скорость» и «Густой мох» помогут быстрее накопить биомассу.",
      code: COLUMN3(["harvest()", "plant(Entities.Shard)"]),
    };
  if (!w.has("variables"))
    return {
      target: "variables",
      text: "Теперь есть if и датчики. Срезайте только созревшее: if can_harvest(): — и тело условия с отступом. get_pos_y() == 0 значит, что дрон снова внизу.",
      code: "while True:\n    if can_harvest():\n        harvest()\n        plant(Entities.Shard)\n    move(North)\n    if get_pos_y() == 0:\n        move(East)",
    };
  if (!w.has("fungus"))
    return {
      target: "fungus",
      text: "Переменные и for … in range(n) обходят поле любого размера. Рядом в древе — «Столпы» и «Функции»: необязательные, но полезные.",
      code: "n = get_world_size()\nwhile True:\n    for x in range(n):\n        for y in range(n):\n            if can_harvest():\n                harvest()\n                plant(Entities.Shard)\n            move(North)\n        move(East)",
    };
  if (!w.has("geodes"))
    return {
      target: "geodes",
      text: "till() превращает камень в пыль, на ней растёт грибница. Она стоит 1 биомассу и 1 кремний, а даёт споры. Повторный till() вернёт камень — проверяйте почву.",
      code: "if get_ground_type() == Grounds.Rock:\n    till()\nplant(Entities.Fungus)",
    };
  if (!w.has("prisms"))
    return {
      target: "prisms",
      text: "Засадите жеодами квадрат и дождитесь, пока созреют все: гигантская жеода k×k даёт k³ самоцветов. Треснувшие (Dead_Geode) соберите и пересадите.",
      code: "n = get_world_size()\nfor x in range(n):\n    for y in range(n):\n        if get_entity_type() == Entities.Dead_Geode:\n            harvest()\n        if get_ground_type() == Grounds.Rock:\n            till()\n        plant(Entities.Geode)\n        move(North)\n    move(East)",
    };
  if (!w.has("maze"))
    return {
      target: "maze",
      text: "measure() — размер призмы, swap(East) меняет её с соседом. Отсортируйте поле так, чтобы размеры росли на восток и на север: группа из n клеток даст n² кристаллов.",
      code: "def sort_line(fwd, back):\n    n = get_world_size()\n    for _ in range(n):\n        for i in range(n - 1):\n            if measure() > measure(fwd):\n                swap(fwd)\n            move(fwd)\n        for i in range(n - 1):\n            move(back)",
    };
  if (!w.has("solar"))
    return {
      target: "solar",
      text: "Солнечники дают энергию, а с ней дрон работает вдвое быстрее. Срежьте цветок с наибольшим числом лепестков, когда зрелых цветков ≥10, — получите 8 энергии.",
      code: "if can_harvest() and measure() == 15:\n    harvest()",
    };
  return {
    target: "beacon",
    text: "use_item(Items.Nanites, get_world_size()) на зрелом осколке выращивает лабиринт. Держитесь правой стены с помощью can_move(), найдите сокровище и соберите золото.",
    code: "dirs = [North, East, South, West]\nd = 0\nwhile get_entity_type() != Entities.Treasure:\n    right = (d + 1) % 4\n    if can_move(dirs[right]):\n        d = right\n        move(dirs[d])\n    elif can_move(dirs[d]):\n        move(dirs[d])\n    else:\n        d = (d + 3) % 4\nharvest()",
  };
}

export interface Lesson {
  title: string;
  unlock: string;
  text: string;
  code: string;
}

/** Учебник: по уроку на каждую конструкцию языка, открываются вместе с навыками. */
export const LESSONS: Lesson[] = [
  {
    title: "Программа и вызовы",
    unlock: "start",
    text: "Программа выполняется сверху вниз, по строке за раз. harvest() — вызов функции: имя и круглые скобки. Каждое действие дрона занимает игровое время, а строки после # — комментарии, их дрон пропускает.",
    code: "harvest()   # собрать то, что под дроном\ndo_a_flip()\nprint(\"Готово\")",
  },
  {
    title: "Циклы и отступы",
    unlock: "loops",
    text: "while условие: повторяет блок, пока условие истинно. Блок — строки с отступом в 4 пробела (клавиша Tab), так Python понимает, что относится к циклу. break выходит из цикла, continue сразу начинает следующий повтор.",
    code: "while True:\n    harvest()\n# эта строка не выполнится никогда:\nprint(\"конец\")",
  },
  {
    title: "Движение по полю",
    unlock: "expand",
    text: "move(North), move(East), move(South), move(West) сдвигают дрона на клетку. Поле закольцовано: шаг за край возвращает дрона с противоположной стороны. get_world_size() — длина стороны поля.",
    code: "while True:\n    harvest()\n    move(North)\n    harvest()\n    move(North)\n    harvest()\n    move(North)\n    move(East)",
  },
  {
    title: "Условия",
    unlock: "senses",
    text: "if выполняет блок, только когда условие истинно; elif и else — запасные ветки. Сравнения: == != < > <= >=. Условия соединяются словами and, or и not.",
    code: "if can_harvest():\n    harvest()\nelif get_entity_type() == None:\n    plant(Entities.Shard)\nelse:\n    do_a_flip()",
  },
  {
    title: "Переменные и for",
    unlock: "variables",
    text: "x = 5 запоминает значение под именем x. Арифметика: + - * / // (деление нацело) % (остаток). for i in range(n): повторяет блок n раз, а i по очереди равна 0, 1, …, n-1.",
    code: "n = get_world_size()\ncount = 0\nfor i in range(n):\n    harvest()\n    count += 1\n    move(North)\nprint(\"собрано:\", count)",
  },
  {
    title: "Функции и файлы",
    unlock: "functions",
    text: "def имя(параметры): объявляет функцию, return возвращает результат. Функцию из другого файла подключают через import file2 (тогда file2.имя()) или from file2 import *. Новый файл создаётся кнопкой «Файл» внизу.",
    code: "def go_to(x, y):\n    while get_pos_x() != x:\n        move(East)\n    while get_pos_y() != y:\n        move(North)\n\ngo_to(2, 3)",
  },
  {
    title: "Списки и словари",
    unlock: "lists",
    text: "Список [a, b, c] хранит значения по порядку: xs[0] — первый, len(xs) — длина, xs.append(v) добавляет в конец. Кортеж (x, y) — неизменяемая пара. Словарь {ключ: значение} ищет значение по ключу.",
    code: "seen = []\nwhat = {}\npos = (get_pos_x(), get_pos_y())\nseen.append(pos)\nwhat[pos] = get_entity_type()\nprint(len(seen), what[pos])",
  },
];

/** Разовые советы: показываются один раз за игру, когда случается повод. */
export const TIPS: Record<string, string> = {
  unripe: "Растение было незрелым и пропало без урожая. Дайте ему дозреть — с навыком «Сенсоры» проверяйте can_harvest() перед harvest().",
  "dead-geode": "Жеода треснула (Dead_Geode) и ничего не дала. Такие нужно собрать и посадить заново.",
  "plant-busy": "plant() вернул False: клетка занята. Сначала соберите урожай harvest(), потом сажайте.",
  "plant-ground": "plant() вернул False: это растение не растёт на камне. Сначала till() — он превращает клетку в пыль.",
  "plant-cost": "plant() вернул False: не хватает ресурсов на посадку. Цены — в «Справке», вкладка «Растения».",
  wrap: "Дрон улетел за край поля и появился с другой стороны — поле закольцовано. На этом можно строить обход.",
  indent: "Python различает блоки по отступам. После строки с двоеточием (while, if, for, def) тело блока сдвигается на 4 пробела — клавиша Tab, обратно — Shift+Tab.",
  name: "Имя не найдено. Проверьте опечатки и регистр (harvest, а не Harvest). Переменной сначала нужно что-то присвоить.",
};

/** Пояснения ключевых слов для подсказки при наведении в редакторе. */
export const KEYWORDS: Record<string, string> = {
  while: "while условие: — повторять блок, пока условие истинно.",
  for: "for x in range(n): — повторить блок для каждого значения.",
  in: "for x in …: перебирает значения; a in xs проверяет, есть ли a в списке.",
  range: "range(n) — числа 0…n-1; range(a, b) — от a до b-1; range(a, b, шаг).",
  if: "if условие: — выполнить блок, только если условие истинно.",
  elif: "elif условие: — запасная проверка, если предыдущие условия ложны.",
  else: "else: — блок на случай, когда ни одно условие не подошло.",
  def: "def имя(параметры): — объявить функцию.",
  return: "return значение — выйти из функции и вернуть результат.",
  break: "break — немедленно выйти из цикла.",
  continue: "continue — перейти к следующему повтору цикла.",
  import: "import файл — подключить код из другого файла.",
  and: "a and b — истинно, если истинны оба.",
  or: "a or b — истинно, если истинно хотя бы одно.",
  not: "not a — меняет истину на ложь и наоборот.",
  True: "Истина.",
  False: "Ложь.",
  None: "«Ничего»: например, get_entity_type() на пустой клетке.",
  pass: "pass — пустая строка-заглушка: ничего не делает.",
  global: "global x — менять внутри функции переменную x из основной программы.",
  len: "len(xs) — длина списка, строки или словаря.",
  print: "print(…) — показать значения над дроном и в окне «Вывод».",
};
