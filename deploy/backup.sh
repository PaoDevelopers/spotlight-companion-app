#!/bin/sh
# Writes a consistent copy of the database (safe while the app runs) and removes copies older than 14 days.
# Installed by INSTALL.md and run nightly by spotlight-backup.timer. Copy the folder off the server too.
set -eu
dir=/var/backups/spotlight
mkdir -p "$dir"
dest="$dir/spotlight-$(date +%Y%m%d-%H%M%S).db"
/opt/spotlight/spotlight -config /etc/spotlight/spotlight.conf backup "$dest"
find "$dir" -name 'spotlight-*.db' -mtime +14 -delete
