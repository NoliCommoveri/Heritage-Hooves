-- Slice 0016 §9.2/§2.1: the admin-door PIN's hash, nullable so pin_hash IS NULL means the gate is
-- off for that account until they set one (§9.6) - a fresh deploy must never lock the operator out.
-- Shared storage for slice 0005 §7's own future parent-PIN consumer, per that slice's "no second
-- hashing scheme" argument (§7.3), which applies with more force now that there are two consumers.
ALTER TABLE accounts ADD COLUMN pin_hash TEXT;
