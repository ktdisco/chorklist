-- Chorklist update: one-time chores.
-- Run this once in Supabase → SQL Editor, after 002_lists.sql.
-- Existing chores keep repeating; nothing else changes.

-- false = a chore that only needs doing once. When it's marked done it leaves
-- the chore list but stays in the history (and Undo brings it back).
alter table public.chores add column repeats boolean not null default true;
