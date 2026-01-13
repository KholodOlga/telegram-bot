import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Создаем подключение к базе данных
const db = new Database(join(__dirname, 'bot.db'));

// Включаем внешние ключи
db.pragma('foreign_keys = ON');

// Инициализация базы данных - создание таблиц
export function initDatabase() {
  // Таблица пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      is_bot BOOLEAN DEFAULT 0,
      language_code TEXT,
      is_premium BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Добавляем новые колонки, если таблица уже существует
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_bot BOOLEAN DEFAULT 0`);
  } catch (e) {
    // Колонка уже существует, игнорируем ошибку
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN language_code TEXT`);
  } catch (e) {
    // Колонка уже существует, игнорируем ошибку
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT 0`);
  } catch (e) {
    // Колонка уже существует, игнорируем ошибку
  }

  // Таблица для задач/напоминаний (пример для продуктивности)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      completed BOOLEAN DEFAULT 0,
      deleted BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      deleted_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Добавляем колонку deleted, если таблица уже существует
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN deleted BOOLEAN DEFAULT 0`);
  } catch (e) {
    // Колонка уже существует, игнорируем ошибку
  }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN deleted_at DATETIME`);
  } catch (e) {
    // Колонка уже существует, игнорируем ошибку
  }

  // Индексы для ускорения запросов
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  `);

  console.log('✅ База данных инициализирована');
}

// Функции для работы с пользователями
export const users = {
  // Создать или обновить пользователя
  upsert(telegramId, username, firstName, lastName, isBot, languageCode, isPremium) {
    const stmt = db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, is_bot, language_code, is_premium, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        is_bot = excluded.is_bot,
        language_code = excluded.language_code,
        is_premium = excluded.is_premium,
        updated_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(telegramId, username, firstName, lastName, isBot ? 1 : 0, languageCode, isPremium ? 1 : 0);
  },

  // Получить пользователя по Telegram ID
  getByTelegramId(telegramId) {
    const stmt = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
    return stmt.get(telegramId);
  },

  // Получить всех пользователей
  getAll() {
    const stmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    return stmt.all();
  }
};

// Функции для работы с задачами
export const tasks = {
  // Создать задачу
  create(userId, title, description = null) {
    const stmt = db.prepare(`
      INSERT INTO tasks (user_id, title, description)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(userId, title, description);
    return result.lastInsertRowid;
  },

  // Получить все задачи пользователя
  getByUserId(userId, includeCompleted = true) {
    let query = 'SELECT * FROM tasks WHERE user_id = ? AND deleted = 0';
    if (!includeCompleted) {
      query += ' AND completed = 0';
    }
    query += ' ORDER BY created_at DESC';
    const stmt = db.prepare(query);
    return stmt.all(userId);
  },

  // Получить задачи пользователя по Telegram ID
  getByTelegramId(telegramId, includeCompleted = true) {
    // Сначала получаем user_id из таблицы users
    const user = users.getByTelegramId(telegramId);
    if (!user) {
      return [];
    }
    return this.getByUserId(user.id, includeCompleted);
  },

  // Отметить задачу как выполненную
  complete(taskId, userId = null) {
    let query = 'UPDATE tasks SET completed = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?';
    const params = [taskId];
    
    // Если указан userId, проверяем что задача принадлежит пользователю
    if (userId !== null) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    
    const stmt = db.prepare(query);
    return stmt.run(...params);
  },

  // Удалить задачу
  delete(taskId) {
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    return stmt.run(taskId);
  },

  // Получить задачу по ID
  getById(taskId) {
    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(taskId);
  },

  // Пометить все задачи пользователя как удаленные
  markAllAsDeleted(userId) {
    const stmt = db.prepare(`
      UPDATE tasks 
      SET deleted = 1, deleted_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND deleted = 0
    `);
    return stmt.run(userId);
  }
};

// Закрытие соединения при завершении приложения
export function closeDatabase() {
  db.close();
  console.log('✅ Соединение с базой данных закрыто');
}

// Экспортируем db для прямого доступа при необходимости
export { db };

