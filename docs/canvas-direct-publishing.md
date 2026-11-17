# Configure direct Canvas publishing

QFlow publishes a validated Canvas package to a course. Canvas Classic Quizzes can also target an
existing or new question bank.

Direct publishing uses the Canvas Content Migrations API. It does not configure Learning Tools
Interoperability (LTI), launch assessments, read rosters, or send grades.

## Access requirements

A Canvas root admin must create an institution-level developer key for QFlow. QFlow requests only
these API scopes when an author connects Canvas:

- `url:POST|/api/v1/courses/:course_id/content_migrations`
- `url:PUT|/api/v1/courses/:course_id/content_migrations/:id`
- `url:GET|/api/v1/courses/:course_id/content_migrations/:id`
- `url:GET|/api/v1/progress/:id`

These scopes let QFlow create a content migration, refresh its signed upload contract, check the
migration, and check its progress. QFlow uploads the package through Canvas's signed upload URL.

Canvas applies the connected author's permissions. That author needs permission to add content to
each destination course.

## Add a Canvas site

In QFlow, a workspace admin completes these steps:

1. Open **Account > Canvas connections**.
2. Copy the redirect URI shown under **Add a Canvas site**.
3. In Canvas, create an account-level developer key and add that redirect URI.
4. In QFlow, enter the Canvas HTTPS origin, client ID, and client secret.
5. Select **Add Canvas site**.

The Canvas URL must be an HTTPS origin without a path, query, fragment, username, or password. QFlow
encrypts the client secret before it stores the connection. The connection belongs to the current
QFlow workspace; it is not deployment-wide configuration.

## Connect an author

Each author completes their own authorization:

1. Open **Account > Canvas connections**.
2. Select **Connect Canvas** for the institution's site.
3. Sign in to Canvas and approve access.

QFlow stores an encrypted refresh token for that QFlow user, workspace, and Canvas connection. It
requests a short-lived access token when the author publishes. Disconnecting removes that personal
grant without removing the workspace's Canvas site.

## Replace a developer key

A workspace admin can expand **Replace developer key** for a Canvas site and enter the replacement
client ID and secret. QFlow updates the encrypted secret only if the page has the current credential
version. Replacing the key revokes every saved user grant and pending authorization request for that
site, so each author must connect Canvas again. QFlow also binds each OAuth request to the
credential version that started it. If an admin replaces the key during authorization, QFlow rejects
the old grant instead of saving it under the new key.

QFlow records connection creation, enable or disable changes, author authorization and disconnects,
and developer-key replacement in the workspace audit log. Canvas reuses the saved refresh token when
it issues a short-lived access token. Audit records contain connection IDs and lifecycle facts,
never secrets or token values.

## Publish an assessment

In the assessment builder, select **Canvas Classic Quizzes** or **Canvas New Quizzes** and complete
the destination preflight. If the package has warnings, review and accept the current warning set.

In **Publish directly to Canvas**:

1. Select the Canvas site.
2. Enter the numeric course ID or exact Canvas SIS course ID, such as `sis_course_id:BIO.101-2026`.
3. For Canvas Classic Quizzes, select the course, an existing question bank ID, or a new question
   bank name.
4. Select **Publish to Canvas**.

QFlow preserves the authorized package before it contacts Canvas. The status panel keeps the package
available for download after the publish attempt begins. When Canvas completes the import, QFlow
records a receipt with the export receipt ID and Canvas content migration ID.

## Recover a publish

When you reopen the assessment, QFlow loads unfinished Canvas publishes for the selected export
target. It lists recent completed and failed publishes separately. Select **Load earlier publishes**
to continue through the history.

If Canvas is still processing the import, select **Check Canvas status**. If QFlow marks the create,
upload, or observation phase for retry, select **Retry Canvas publish**. QFlow resumes that phase of
the same local attempt.

If Canvas rejects the connected account or its permissions, reconnect the Canvas account before you
retry. The retry requests a new short-lived token.

If a create request might have reached Canvas but QFlow did not receive a migration ID, QFlow stops
the attempt. Check the course for a package whose name begins with the QFlow publish ID. Then select
**I found the import** or **No import found**. QFlow records the result and closes the attempt.

After an attempt completes or closes, select **Start another Canvas publish** to create a new
publish ID.

Canvas documents the remote workflow in its
[Content Migrations API](https://developerdocs.instructure.com/services/canvas/resources/content_migrations)
and
[File Uploads guide](https://developerdocs.instructure.com/services/canvas/basics/file.file_uploads).
