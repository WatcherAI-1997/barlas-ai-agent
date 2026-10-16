alter table user_accounts
  add column if not exists language_code text;

alter table user_accounts
  drop constraint if exists user_accounts_language_code_check;

alter table user_accounts
  add constraint user_accounts_language_code_check check (
    language_code is null or language_code in (
      'tr', 'az', 'azb', 'tk', 'gag', 'qxq', 'kmz', 'klj', 'uz', 'ug', 'ili', 'slr', 'ybe',
      'kk', 'ky', 'kaa', 'nog', 'tt', 'ba', 'crh', 'kum', 'krc', 'kdr', 'uum', 'cv', 'sah',
      'dlg', 'tyv', 'kim', 'alt', 'kjh', 'cjs', 'clw', 'fuy', 'sty', 'ru', 'en'
    )
  );

create index if not exists user_accounts_language_idx
  on user_accounts (language_code) where language_code is not null;
