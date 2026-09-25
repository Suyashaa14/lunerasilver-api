# Backup and restore

Everything the business depends on — invoices, payments, the ledger — lives in
one MySQL database. Without a copy somewhere else, one failed disk ends it.
A Pvt Ltd also has to keep its records, and "the disk died" is not a defence.

## Taking a backup

```bash
cd lunerasilver-api
npm run backup
```

Writes a gzipped dump to `backups/` and then **reads it back** to check it
really contains the tables and rows it should. An unverified backup is not a
backup, so the script refuses to report success unless the file is readable.

A dump that fails, or fails verification, is deleted rather than left sitting
next to the good ones where it would look like a backup until the day you
needed it.

The last 30 are kept; older ones are pruned. Change with `BACKUP_KEEP`, or the
location with `BACKUP_DIR`.

## Run it automatically

Nightly at 2am, via `crontab -e`:

```
0 2 * * * cd /path/to/lunerasilver-api && /usr/local/bin/npm run backup >> backups/backup.log 2>&1
```

**`backups/` is in `.gitignore` and sits on the same machine as the database.**
That protects against a bad command or a dropped table. It does not protect
against the machine dying. Copy the folder somewhere else — another disk, or
cloud storage — or the backup shares the fate of the thing it is backing up.

## Restoring

```bash
gunzip -c backups/lunerasilver-2026-09-25T19-19-13.sql.gz | \
  mysql -h127.0.0.1 -u<user> -p <database>
```

Then re-run `npm run migrate` to be sure the schema is current.

## Practise it

A backup nobody has restored is a guess. Restore into a **scratch database**
once, confirm the invoice numbers and the trial balance look right, then drop
it. Do that now, while it does not matter.

Creating a scratch database needs privileges the application user does not
have, so it is a manual step:

```sql
CREATE DATABASE lunerasilver_restoretest;
GRANT ALL ON lunerasilver_restoretest.* TO '<app user>'@'localhost';
```

## If you see the consistency warning

```
WARNING: this is not a point-in-time snapshot.
```

It means the dump could not be taken as a single instant, so a sale recorded
while it ran might be captured half-written — an invoice without its journal
entry. Fix it once, as root:

```sql
GRANT RELOAD ON *.* TO '<app user>'@'localhost';
FLUSH PRIVILEGES;
```

On this machine the consistent snapshot already works, so you should not see it.
