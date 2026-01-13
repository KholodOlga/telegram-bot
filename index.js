import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import { initDatabase, users, tasks, closeDatabase } from './database.js';

// Загружаем переменные окружения
dotenv.config();

// Инициализируем базу данных
initDatabase();

// Проверяем наличие токена
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Ошибка: BOT_TOKEN не установлен в переменных окружения!');
  console.error('Создайте файл .env и добавьте туда BOT_TOKEN=ваш_токен');
  process.exit(1);
}

// Создаем экземпляр бота
const bot = new Telegraf(BOT_TOKEN);

// Middleware для сохранения пользователей в БД
bot.use(async (ctx, next) => {
  if (ctx.from) {
    users.upsert(
      ctx.from.id,
      ctx.from.username || null,
      ctx.from.first_name || null,
      ctx.from.last_name || null,
      ctx.from.is_bot || false,
      ctx.from.language_code || null,
      ctx.from.is_premium || false
    );
  }
  return next();
});

// Обработчик команды /start
bot.start((ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 Создать задачу', 'create_task'),
      Markup.button.callback('📋 Мои задачи', 'list_tasks')
    ],
    [
      Markup.button.callback('ℹ️ Помощь', 'show_help')
    ]
  ]);

  ctx.reply(
    `Привет, ${ctx.from.first_name}! 👋\n\n` +
    `Я бот для повышения продуктивности. Вот что я умею:\n\n` +
    `/start - показать это сообщение\n` +
    `/help - помощь\n` +
    `/hello - поздороваться\n` +
    `/newtask - создать новую задачу\n` +
    `/tasks - показать список задач\n` +
    `/done - отметить задачу выполненной`,
    keyboard
  );
});

// Обработчик команды /help
bot.help((ctx) => {
  ctx.reply(
    'Доступные команды:\n\n' +
    '/start - начать работу с ботом\n' +
    '/help - показать эту справку\n' +
    '/hello - поздороваться\n\n' +
    '📝 Работа с задачами:\n' +
    '/newtask <название> - создать новую задачу\n' +
    '/tasks - показать список всех задач\n' +
    '/done <номер> - отметить задачу выполненной'
  );
});

// Обработчики callback-кнопок
bot.action('create_task', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(
    '📝 Создание новой задачи\n\n' +
    'Используйте команду:\n' +
    '/newtask <название задачи>\n\n' +
    'Пример: /newtask Купить молоко'
  );
});

bot.action('list_tasks', (ctx) => {
  ctx.answerCbQuery();
  
  const user = users.getByTelegramId(ctx.from.id);
  if (!user) {
    return ctx.reply('Ошибка: пользователь не найден. Попробуйте отправить /start');
  }

  const userTasks = tasks.getByUserId(user.id, true);
  const { message, keyboard } = formatTasksList(userTasks);

  if (keyboard) {
    ctx.reply(message, keyboard);
  } else {
    ctx.reply(message);
  }
});

bot.action('delete_all_tasks', async (ctx) => {
  const user = users.getByTelegramId(ctx.from.id);
  if (!user) {
    ctx.answerCbQuery('Ошибка: пользователь не найден', { show_alert: true });
    return;
  }

  const userTasks = tasks.getByUserId(user.id, true);
  if (userTasks.length === 0) {
    ctx.answerCbQuery('У вас нет задач для удаления', { show_alert: true });
    return;
  }

  // Помечаем все задачи как удаленные
  const result = tasks.markAllAsDeleted(user.id);
  
  if (result.changes > 0) {
    ctx.answerCbQuery(`✅ Все задачи (${result.changes}) помечены как удаленные`);
    ctx.editMessageText('✅ Все задачи помечены как удаленные.\n\nИспользуйте /tasks для просмотра активных задач.');
  } else {
    ctx.answerCbQuery('Нечего удалять', { show_alert: true });
  }
});

bot.action('show_help', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(
    'Доступные команды:\n\n' +
    '/start - начать работу с ботом\n' +
    '/help - показать эту справку\n' +
    '/hello - поздороваться\n\n' +
    '📝 Работа с задачами:\n' +
    '/newtask <название> - создать новую задачу\n' +
    '/tasks - показать список всех задач\n' +
    '/done <номер> - отметить задачу выполненной'
  );
});

// Обработчик команды /hello
bot.command('hello', (ctx) => {
  ctx.reply(`Привет, ${ctx.from.first_name}! Как дела? 😊`);
});

// Команда создания задачи /newtask
bot.command('newtask', (ctx) => {
  const user = users.getByTelegramId(ctx.from.id);
  if (!user) {
    return ctx.reply('Ошибка: пользователь не найден. Попробуйте отправить /start');
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    return ctx.reply(
      'Использование: /newtask <название задачи>\n\n' +
      'Пример: /newtask Купить молоко'
    );
  }

  const title = args.join(' ');
  const taskId = tasks.create(user.id, title);

  ctx.reply(`✅ Задача создана!\n\nID: ${taskId}\nНазвание: ${title}`);
});

// Функция для формирования сообщения со списком задач
function formatTasksList(userTasks) {
  if (userTasks.length === 0) {
    return { message: '📝 У вас пока нет задач. Создайте первую задачу командой /newtask', keyboard: null };
  }

  let message = '📝 Ваши задачи:\n\n';
  
  userTasks.forEach((task, index) => {
    const status = task.completed ? '✅' : '⏳';
    const completedText = task.completed ? ` (выполнена ${new Date(task.completed_at).toLocaleDateString('ru-RU')})` : '';
    message += `${status} ${index + 1}. [ID: ${task.id}] ${task.title}${completedText}\n`;
    if (task.description) {
      message += `   └ ${task.description}\n`;
    }
  });

  message += '\n💡 Используйте /done <номер> чтобы отметить задачу выполненной';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ Удалить все задачи', 'delete_all_tasks')]
  ]);

  return { message, keyboard };
}

// Команда получения списка задач /tasks
bot.command('tasks', (ctx) => {
  const user = users.getByTelegramId(ctx.from.id);
  if (!user) {
    return ctx.reply('Ошибка: пользователь не найден. Попробуйте отправить /start');
  }

  const userTasks = tasks.getByUserId(user.id, true);
  const { message, keyboard } = formatTasksList(userTasks);

  if (keyboard) {
    ctx.reply(message, keyboard);
  } else {
    ctx.reply(message);
  }
});

// Команда отметки задачи выполненной /done
bot.command('done', (ctx) => {
  const user = users.getByTelegramId(ctx.from.id);
  if (!user) {
    return ctx.reply('Ошибка: пользователь не найден. Попробуйте отправить /start');
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    return ctx.reply(
      'Использование: /done <ID задачи>\n\n' +
      'Пример: /done 1\n\n' +
      '💡 Используйте /tasks чтобы увидеть список задач с их ID'
    );
  }

  const taskId = parseInt(args[0]);
  if (isNaN(taskId)) {
    return ctx.reply('❌ Ошибка: ID задачи должен быть числом');
  }

  const task = tasks.getById(taskId);
  if (!task) {
    return ctx.reply('❌ Задача с таким ID не найдена');
  }

  if (task.user_id !== user.id) {
    return ctx.reply('❌ Эта задача не принадлежит вам');
  }

  if (task.completed) {
    return ctx.reply('ℹ️ Эта задача уже отмечена как выполненная');
  }

  tasks.complete(taskId, user.id);
  ctx.reply(`✅ Задача "${task.title}" отмечена как выполненная! 🎉`);
});

// Обработчик текстовых сообщений
bot.on('text', (ctx) => {
  const message = ctx.message.text.toLowerCase();
  
  if (message.includes('привет') || message.includes('здравствуй')) {
    ctx.reply('Привет! Чем могу помочь?');
  } else if (message.includes('пока') || message.includes('до свидания')) {
    ctx.reply('До свидания! Удачи! 👋');
  } else {
    ctx.reply('Я пока учусь понимать сообщения. Используйте команды из /help');
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('Произошла ошибка. Попробуйте позже.');
});

// Запускаем бота
console.log('🤖 Бот запущен...');
bot.launch();

// Graceful stop
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  closeDatabase();
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  closeDatabase();
  process.exit(0);
});

