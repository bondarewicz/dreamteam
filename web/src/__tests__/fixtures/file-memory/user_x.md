---
name: user_x_mismatch
description: This file has a user_ prefix but is actually type project
type: project
---
This is a project-scoped fact. The filename prefix says user_ but the type field says project.
The type field is authoritative (BR-MIG-1) and the mismatch must be logged.
