# Use a content version media table

Stage 3 stores image bindings in `content_version_media` instead of relying only on JSON inside `content_versions.payload_json`. This makes the reviewed file set a database fact: a temporary private file can be consumed by only one submitted content version, item photos can be validated as exactly front/back/side/detail, and later file access checks can join against the approved content version rather than trusting mutable payload structure.
