-- A move inside one club (its reserve side to its first team): a kind of its own, alone in its
-- migration as a new enum value must be (105).
ALTER TYPE core.transfer_kind ADD VALUE IF NOT EXISTS 'internal';
