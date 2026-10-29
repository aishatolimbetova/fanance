// Адрес проекта Supabase и публичный (publishable) ключ.
// Этот ключ можно хранить в браузере: доступ к данным ограничен политиками RLS из supabase/schema.sql.
window.CONFIG = {
  url: "https://tlfprpskqvhgnuwhhjqt.supabase.co",
  key: "sb_publishable_CInA8Nc5v-g9dr1uGZRCMQ_w3MPBdeR",
  // Контакты поддержки (необязательно). Кнопки связи покажутся только для заполненных полей.
  // ИИ-помощник. По умолчанию запросы идут на /api/ai (server.js, нужен ANTHROPIC_API_KEY).
  // Для статического хостинга укажите адрес Supabase Edge Function: url: "https://<проект>.supabase.co/functions/v1/ai"
  ai: { url: "" },
  // ИИ-чат напрямую через Gemini. ВАЖНО: в Google AI Studio / Cloud Console ограничьте этот ключ по HTTP-referrer (адрес вашего сайта).
  gemini: { key: "AQ.Ab8RN6Ij7ETVrbircSSrTK-Falh3F6WuBHk7J8rDhwfAL_wGBQ", model: "gemini-2.5-flash" },
  support: { whatsapp: "", telegram: "", email: "", phone: "" },
};
