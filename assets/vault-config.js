// Exam Vault — Supabase connection.
// Paste your project's values from Supabase Dashboard → Project Settings → API.
// The anon (public) key is safe to publish: access is enforced by the Row Level Security
// rules in supabase/schema.sql. Never put the service_role key here.
//
// While these are left as placeholders, the Exam Vault shows sample papers from
// data/sample-papers.json and the admin page shows setup instructions.
window.YMA_VAULT_CONFIG = {
  supabaseUrl: 'YOUR_SUPABASE_URL',        // e.g. https://abcdefgh.supabase.co
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  bucket: 'papers',
};

// Shared taxonomy used by the public vault and the admin upload form.
window.YMA_TAXONOMY = {
  boards: [
    { value: 'CBSE', label: 'CBSE' },
    { value: 'ICSE', label: 'ICSE' },
    { value: 'ISC', label: 'ISC' },
    { value: 'STATE_BOARD', label: 'State Board' },
  ],
  classes: [
    { value: 9, label: 'Class 9' },
    { value: 10, label: 'Class 10' },
    { value: 11, label: 'Class 11' },
    { value: 12, label: 'Class 12' },
    { value: 13, label: 'Dropper / Target' },
  ],
  subjects: {
    junior: ['Mathematics', 'Science', 'Physics', 'Chemistry', 'Biology', 'Social Science', 'English', 'Hindi'],
    senior: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Accountancy', 'Economics', 'Business Studies',
      'Computer Science', 'Informatics Practices', 'English Core'],
  },
  categories: [
    { value: 'PYQ_OFFICIAL', label: 'Previous Year Papers', short: 'PYQ' },
    { value: 'GUESS_PAPER', label: 'Faculty Guess Papers', short: 'Guess Paper' },
    { value: 'SAMPLE_PAPER', label: 'Sample Papers', short: 'Sample Paper' },
    { value: 'PRE_BOARD_MASTERS', label: 'Pre-Board Masters', short: 'Pre-Board' },
    { value: 'CHAPTERWISE_PYQ', label: 'Chapter-wise PYQs', short: 'Chapter-wise PYQ' },
  ],
  regions: ['Delhi', 'Outside Delhi', 'All India', 'Foreign', 'Term-1', 'Term-2'],
  firstYear: 2015,
};
