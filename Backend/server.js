const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mysql = require("mysql2");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const oauthStates = new Map();
const userSessions = new Map();
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5500/frontend";

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Kaveri1305@@",
  database: "notes_db"
});

db.connect((err) => {
  if (err) {
    console.log(err);
  } else {
    console.log("Database Connected");
    ensureSupportTables();
  }
});

function ensureSupportTables() {
  const createDownloadTableSql = `
    CREATE TABLE IF NOT EXISTS note_downloads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      note_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_note_downloads_note_id (note_id)
    )`;

  const createNoteRequestsTableSql = `
    CREATE TABLE IF NOT EXISTS note_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT '',
      course VARCHAR(100) DEFAULT '',
      semester VARCHAR(100) DEFAULT '',
      subject VARCHAR(150) DEFAULT '',
      details TEXT,
      needed_notes VARCHAR(200),
      extra_details TEXT,
      user_email VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_note_requests_created_at (created_at),
      INDEX idx_note_requests_user_email (user_email)
    )`;

  const createLikesTableSql = `
    CREATE TABLE IF NOT EXISTS likes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      note_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_likes_note_id (note_id)
    )`;

  const createCommentsTableSql = `
    CREATE TABLE IF NOT EXISTS comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      note_id INT NOT NULL,
      comment TEXT NOT NULL,
      user_email VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_comments_note_id (note_id),
      INDEX idx_comments_user_email (user_email)
    )`;

  db.query(createDownloadTableSql, (err) => {
    if (err) {
      console.log("Unable to ensure note_downloads table", err);
    }
  });

  db.query(createNoteRequestsTableSql, (err) => {
    if (err) {
      console.log("Unable to ensure note_requests table", err);
      return;
    }

    ensureNoteRequestColumns();
  });

  db.query(createLikesTableSql, (err) => {
    if (err) {
      console.log("Unable to ensure likes table", err);
    }
  });

  db.query(createCommentsTableSql, (err) => {
    if (err) {
      console.log("Unable to ensure comments table", err);
      return;
    }

    ensureCommentColumns();
  });
}

function ensureNoteRequestColumns() {
  const requiredColumns = [
    { name: "title", definition: "VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: "course", definition: "VARCHAR(100) DEFAULT ''" },
    { name: "semester", definition: "VARCHAR(100) DEFAULT ''" },
    { name: "subject", definition: "VARCHAR(150) DEFAULT ''" },
    { name: "details", definition: "TEXT" },
    { name: "needed_notes", definition: "VARCHAR(200)" },
    { name: "extra_details", definition: "TEXT" },
    { name: "user_email", definition: "VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" }
  ];

  db.query("SHOW COLUMNS FROM note_requests", (err, columns) => {
    if (err) {
      console.log("Unable to inspect note_requests table", err);
      return;
    }

    const existingColumns = new Set(columns.map((column) => column.Field.toLowerCase()));

    requiredColumns.forEach((column) => {
      if (existingColumns.has(column.name.toLowerCase())) {
        return;
      }

      db.query(`ALTER TABLE note_requests ADD COLUMN ${column.name} ${column.definition}`, (alterErr) => {
        if (alterErr) {
          console.log(`Unable to add note_requests.${column.name}`, alterErr);
        }
      });
    });
  });
}

function ensureCommentColumns() {
  const requiredColumns = [
    { name: "user_email", definition: "VARCHAR(255) NOT NULL DEFAULT ''" },
    { name: "created_at", definition: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" }
  ];

  db.query("SHOW COLUMNS FROM comments", (err, columns) => {
    if (err) {
      console.log("Unable to inspect comments table", err);
      return;
    }

    const existingColumns = new Set(columns.map((column) => column.Field.toLowerCase()));

    requiredColumns.forEach((column) => {
      if (existingColumns.has(column.name.toLowerCase())) {
        return;
      }

      db.query(`ALTER TABLE comments ADD COLUMN ${column.name} ${column.definition}`, (alterErr) => {
        if (alterErr) {
          console.log(`Unable to add comments.${column.name}`, alterErr);
        }
      });
    });
  });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

function findUserByEmail(email, callback) {
  db.query("SELECT email FROM users WHERE email=?", [email], (err, result) => {
    if (err) {
      callback(err);
      return;
    }

    callback(null, result.length > 0);
  });
}

function ensureOAuthUser(name, email, provider, callback) {
  const password = `${provider}-oauth-user`;

  db.query("SELECT email FROM users WHERE email=?", [email], (selectErr, result) => {
    if (selectErr) {
      callback(selectErr);
      return;
    }

    if (result.length > 0) {
      callback(null);
      return;
    }

    db.query(
      "INSERT INTO users(name,email,password) VALUES (?,?,?)",
      [name || provider, email, password],
      callback
    );
  });
}

function createOAuthState(provider, redirectTo) {
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.set(state, {
    provider,
    redirectTo: redirectTo || `${frontendUrl}/notes.html`,
    createdAt: Date.now()
  });
  return state;
}

function consumeOAuthState(state, provider) {
  const entry = oauthStates.get(state);
  oauthStates.delete(state);

  if (!entry || entry.provider !== provider || Date.now() - entry.createdAt > 10 * 60 * 1000) {
    return null;
  }

  return entry;
}

function redirectAfterOAuth(res, redirectTo, email) {
  const url = new URL(redirectTo || `${frontendUrl}/notes.html`);
  url.searchParams.set("oauthEmail", email);
  url.searchParams.set("authToken", createUserSession(email));
  res.redirect(url.toString());
}

function createUserSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  userSessions.set(token, email);
  return token;
}

function isValidUserSession(email, token) {
  return Boolean(token && userSessions.get(token) === email);
}

function sendOAuthSetupMessage(res, provider) {
  res.status(501).send(
    `${provider} sign-in is ready in the app, but OAuth credentials are not configured on the backend yet.`
  );
}

let noteSchemaSupport = null;
let noteRequestSchemaSupport = null;
let commentSchemaSupport = null;

function getNoteSchemaSupport(callback) {
  if (noteSchemaSupport) {
    callback(null, noteSchemaSupport);
    return;
  }

  db.query("SHOW COLUMNS FROM notes", (err, columns) => {
    if (err) {
      callback(err);
      return;
    }

    const fieldNames = columns.map((column) => column.Field.toLowerCase());

    noteSchemaSupport = {
      hasCourse: fieldNames.includes("course"),
      hasSemester: fieldNames.includes("semester")
    };

    callback(null, noteSchemaSupport);
  });
}

function getNoteRequestSchemaSupport(callback) {
  db.query("SHOW COLUMNS FROM note_requests", (err, columns) => {
    if (err) {
      callback(err);
      return;
    }

    const fieldNames = columns.map((column) => column.Field.toLowerCase());
    noteRequestSchemaSupport = {
      hasTitle: fieldNames.includes("title"),
      hasNeededNotes: fieldNames.includes("needed_notes"),
      hasDetails: fieldNames.includes("details"),
      hasExtraDetails: fieldNames.includes("extra_details"),
      hasUserEmail: fieldNames.includes("user_email"),
      hasCreatedAt: fieldNames.includes("created_at")
    };

    callback(null, noteRequestSchemaSupport);
  });
}

function getCommentSchemaSupport(callback) {
  db.query("SHOW COLUMNS FROM comments", (err, columns) => {
    if (err) {
      callback(err);
      return;
    }

    const fieldNames = columns.map((column) => column.Field.toLowerCase());
    commentSchemaSupport = {
      hasUserEmail: fieldNames.includes("user_email"),
      hasCreatedAt: fieldNames.includes("created_at")
    };

    callback(null, commentSchemaSupport);
  });
}

app.post("/upload-note", upload.single("file"), (req, res) => {
  const title = req.body.title;
  const subject = req.body.subject;
  const course = req.body.course || "";
  const semester = req.body.semester || "";
  const file = req.file ? req.file.filename : "";
  const email = req.body.email;

  if (!email) {
    return res.send("User not logged in");
  }

  if (!file) {
    return res.send("Please choose a file");
  }

  getNoteSchemaSupport((schemaErr, schema) => {
    if (schemaErr) {
      console.log(schemaErr);
      res.send("Upload failed");
      return;
    }

    const hasExtendedFields = schema.hasCourse && schema.hasSemester;
    const sql = hasExtendedFields
      ? "INSERT INTO notes(title,course,semester,subject,file,user_email) VALUES (?,?,?,?,?,?)"
      : "INSERT INTO notes(title,subject,file,user_email) VALUES (?,?,?,?)";
    const values = hasExtendedFields
      ? [title, course, semester, subject, file, email]
      : [title, subject, file, email];

    db.query(sql, values, (err) => {
      if (err) {
        console.log(err);
        res.send("Upload failed");
      } else {
        res.send("Note uploaded");
      }
    });
  });
});

app.get("/notes", (req, res) => {
  const sql = `
    SELECT
      notes.*,
      COALESCE(NULLIF(TRIM(users.name), ''), 'Unknown user') AS uploader_name,
      COALESCE(download_totals.total, 0) AS download_count
    FROM notes
    LEFT JOIN users ON notes.user_email = users.email
    LEFT JOIN (
      SELECT note_id, COUNT(*) AS total
      FROM note_downloads
      GROUP BY note_id
    ) AS download_totals ON notes.id = download_totals.note_id
    ORDER BY notes.id DESC`;

  db.query(sql, (err, result) => {
    if (err) {
      res.send(err);
    } else {
      res.send(result);
    }
  });
});

app.get("/note-requests", (req, res) => {
  getNoteRequestSchemaSupport((schemaErr, schema) => {
    if (schemaErr) {
      console.log(schemaErr);
      res.status(500).send("Unable to load note requests");
      return;
    }

    const titleParts = [];
    const detailsParts = [];

    if (schema.hasTitle) {
      titleParts.push("NULLIF(TRIM(note_requests.title), '')");
    }

    if (schema.hasNeededNotes) {
      titleParts.push("NULLIF(TRIM(note_requests.needed_notes), '')");
    }

    if (schema.hasDetails) {
      detailsParts.push("NULLIF(TRIM(note_requests.details), '')");
    }

    if (schema.hasExtraDetails) {
      detailsParts.push("NULLIF(TRIM(note_requests.extra_details), '')");
    }

    const userEmailSelect = schema.hasUserEmail
      ? "note_requests.user_email"
      : "'' AS user_email";
    const createdAtSelect = schema.hasCreatedAt
      ? "note_requests.created_at"
      : "NULL AS created_at";
    const titleSelect = `COALESCE(${titleParts.concat("'Untitled request'").join(", ")}) AS title`;
    const detailsSelect = detailsParts.length
      ? `COALESCE(${detailsParts.join(", ")}) AS details`
      : "'' AS details";
    const requesterSelect = schema.hasUserEmail
      ? "COALESCE(NULLIF(TRIM(users.name), ''), NULLIF(TRIM(note_requests.user_email), ''), 'Unknown student') AS requester_name"
      : "'Unknown student' AS requester_name";
    const joinUsers = schema.hasUserEmail
      ? "LEFT JOIN users ON note_requests.user_email = users.email"
      : "";

    const sql = `
      SELECT
        note_requests.id,
        note_requests.course,
        note_requests.semester,
        note_requests.subject,
        ${userEmailSelect},
        ${createdAtSelect},
        ${titleSelect},
        ${detailsSelect},
        ${requesterSelect}
      FROM note_requests
      ${joinUsers}
      ORDER BY note_requests.id DESC`;

    db.query(sql, (err, result) => {
      if (err) {
        console.log(err);
        res.status(500).send("Unable to load note requests");
        return;
      }

      res.send(result);
    });
  });
});

app.post("/note-request", (req, res) => {
  const title = (req.body.title || "").trim();
  const course = (req.body.course || "").trim();
  const semester = (req.body.semester || "").trim();
  const subject = (req.body.subject || "").trim();
  const details = (req.body.details || "").trim();
  const email = (req.body.email || "").trim();

  if (!email) {
    res.status(401).send("User not logged in");
    return;
  }

  if (!title) {
    res.status(400).send("Please enter the notes you need");
    return;
  }

  getNoteRequestSchemaSupport((schemaErr, schema) => {
    if (schemaErr) {
      console.log(schemaErr);
      res.status(500).send("Request failed");
      return;
    }

    const columns = [];
    const placeholders = [];
    const values = [];

    if (schema.hasTitle) {
      columns.push("title");
      placeholders.push("?");
      values.push(title);
    } else if (schema.hasNeededNotes) {
      columns.push("needed_notes");
      placeholders.push("?");
      values.push(title);
    } else {
      res.status(500).send("Request table is missing a notes title column");
      return;
    }

    ["course", "semester", "subject"].forEach((column) => {
      columns.push(column);
      placeholders.push("?");
    });
    values.push(course, semester, subject);

    if (schema.hasDetails) {
      columns.push("details");
      placeholders.push("?");
      values.push(details);
    } else if (schema.hasExtraDetails) {
      columns.push("extra_details");
      placeholders.push("?");
      values.push(details);
    }

    if (schema.hasUserEmail) {
      columns.push("user_email");
      placeholders.push("?");
      values.push(email);
    }

    const sql = `INSERT INTO note_requests(${columns.join(",")}) VALUES (${placeholders.join(",")})`;

    db.query(sql, values, (err) => {
      if (err) {
        console.log(err);
        res.status(500).send("Request failed");
        return;
      }

      noteRequestSchemaSupport = null;
      res.send("Request added");
    });
  });
});

app.post("/like", (req, res) => {
  const { note_id } = req.body;
  const sql = "INSERT INTO likes(note_id) VALUES (?)";

  db.query(sql, [note_id], () => {
    res.send("Liked");
  });
});

app.get("/likes/:id", (req, res) => {
  const id = req.params.id;
  const sql = "SELECT COUNT(*) as total FROM likes WHERE note_id=?";

  db.query(sql, [id], (err, result) => {
    res.send(result);
  });
});

app.post("/comment", (req, res) => {
  const note_id = Number(req.body.note_id);
  const comment = (req.body.comment || "").trim();
  const email = (req.body.email || "").trim();

  if (!Number.isInteger(note_id) || note_id <= 0) {
    res.status(400).send("Invalid note");
    return;
  }

  if (!comment) {
    res.status(400).send("Please write a comment");
    return;
  }

  getCommentSchemaSupport((schemaErr, schema) => {
    if (schemaErr) {
      console.log(schemaErr);
      res.status(500).send("Comment failed");
      return;
    }

    const columns = ["note_id", "comment"];
    const placeholders = ["?", "?"];
    const values = [note_id, comment];

    if (schema.hasUserEmail) {
      columns.push("user_email");
      placeholders.push("?");
      values.push(email);
    }

    const sql = `INSERT INTO comments(${columns.join(",")}) VALUES (${placeholders.join(",")})`;

    db.query(sql, values, (err) => {
      if (err) {
        console.log(err);
        res.status(500).send("Comment failed");
        return;
      }

      commentSchemaSupport = null;
      res.send("Comment Added");
    });
  });
});

app.get("/comments/:id", (req, res) => {
  const id = req.params.id;
  const sql = "SELECT * FROM comments WHERE note_id=?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send("Unable to load comments");
      return;
    }

    res.send(result);
  });
});

app.get("/download/:file", (req, res) => {
  const fileName = path.basename(req.params.file);
  const noteId = Number(req.query.noteId);
  const email = (req.query.email || "").trim();
  const filePath = path.join(__dirname, "uploads", fileName);

  function sendFile() {
    res.download(filePath, fileName, (err) => {
      if (err && !res.headersSent) {
        console.log(err);
        res.status(500).send("Download failed");
      }
    });
  }

  if (!email) {
    res.status(401).send("Please login first to download notes");
    return;
  }

  findUserByEmail(email, (userErr, userExists) => {
    if (userErr) {
      console.log(userErr);
      res.status(500).send("Download failed");
      return;
    }

    if (!userExists) {
      res.status(401).send("Please login first to download notes");
      return;
    }

    if (!Number.isInteger(noteId) || noteId <= 0) {
      sendFile();
      return;
    }

    db.query("INSERT INTO note_downloads(note_id) VALUES (?)", [noteId], (err) => {
      if (err) {
        console.log(err);
      }
      sendFile();
    });
  });
});

app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    sendOAuthSetupMessage(res, "Google");
    return;
  }

  const state = createOAuthState("google", req.query.redirectTo);
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback";
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");
  res.redirect(authUrl.toString());
});

app.get("/auth/google/callback", async (req, res) => {
  const entry = consumeOAuthState(req.query.state, "google");

  if (!entry) {
    res.status(400).send("Invalid Google sign-in request");
    return;
  }

  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback";
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    const tokenData = await tokenRes.json();
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    if (!profile.email) {
      res.status(400).send("Google did not return an email address");
      return;
    }

    ensureOAuthUser(profile.name, profile.email, "google", (err) => {
      if (err) {
        console.log(err);
        res.status(500).send("Google sign-in failed");
        return;
      }

      redirectAfterOAuth(res, entry.redirectTo, profile.email);
    });
  } catch (err) {
    if (err) {
      console.log(err);
    }
    res.status(500).send("Google sign-in failed");
  }
});

app.get("/auth/github", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    sendOAuthSetupMessage(res, "GitHub");
    return;
  }

  const state = createOAuthState("github", req.query.redirectTo);
  const redirectUri = process.env.GITHUB_REDIRECT_URI || "http://localhost:3000/auth/github/callback";
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read:user user:email");
  authUrl.searchParams.set("state", state);
  res.redirect(authUrl.toString());
});

app.get("/auth/github/callback", async (req, res) => {
  const entry = consumeOAuthState(req.query.state, "github");

  if (!entry) {
    res.status(400).send("Invalid GitHub sign-in request");
    return;
  }

  try {
    const redirectUri = process.env.GITHUB_REDIRECT_URI || "http://localhost:3000/auth/github/callback";
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        code: req.query.code,
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        redirect_uri: redirectUri
      })
    });
    const tokenData = await tokenRes.json();
    const profileRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "student-notes-platform"
      }
    });
    const profile = await profileRes.json();
    const emailRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "student-notes-platform"
      }
    });
    const emails = await emailRes.json();
    const primaryEmail = Array.isArray(emails)
      ? emails.find((item) => item.primary && item.verified) || emails.find((item) => item.verified)
      : null;

    if (!primaryEmail || !primaryEmail.email) {
      res.status(400).send("GitHub did not return a verified email address");
      return;
    }

    ensureOAuthUser(profile.name || profile.login, primaryEmail.email, "github", (err) => {
      if (err) {
        console.log(err);
        res.status(500).send("GitHub sign-in failed");
        return;
      }

      redirectAfterOAuth(res, entry.redirectTo, primaryEmail.email);
    });
  } catch (err) {
    if (err) {
      console.log(err);
    }
    res.status(500).send("GitHub sign-in failed");
  }
});

app.delete("/delete/:id", (req, res) => {
  const id = req.params.id;
  const email = (req.body.email || "").trim();
  const authToken = (req.body.authToken || "").trim();

  if (!email || !isValidUserSession(email, authToken)) {
    res.status(401).send("Please login first to delete notes");
    return;
  }

  db.query("SELECT user_email FROM notes WHERE id=?", [id], (selectErr, notes) => {
    if (selectErr) {
      console.log(selectErr);
      res.status(500).send("Delete failed");
      return;
    }

    if (!notes.length) {
      res.status(404).send("Note not found");
      return;
    }

    if (notes[0].user_email !== email) {
      res.status(403).send("You can only delete notes you uploaded");
      return;
    }

    db.query("DELETE FROM note_downloads WHERE note_id=?", [id], (downloadErr) => {
      if (downloadErr) {
        console.log(downloadErr);
        res.status(500).send("Delete failed");
        return;
      }

      db.query("DELETE FROM likes WHERE note_id=?", [id], (likesErr) => {
        if (likesErr) {
          console.log(likesErr);
          res.status(500).send("Delete failed");
          return;
        }

        db.query("DELETE FROM comments WHERE note_id=?", [id], (commentsErr) => {
          if (commentsErr) {
            console.log(commentsErr);
            res.status(500).send("Delete failed");
            return;
          }

          db.query("DELETE FROM notes WHERE id=? AND user_email=?", [id, email], (noteErr, result) => {
            if (noteErr) {
              console.log(noteErr);
              res.status(500).send("Delete failed");
              return;
            }

            if (result.affectedRows === 0) {
              res.status(403).send("You can only delete notes you uploaded");
              return;
            }

            res.send("Note Deleted");
          });
        });
      });
    });
  });
});

app.delete("/note-request/:id", (req, res) => {
  const id = Number(req.params.id);
  const email = (req.body.email || "").trim();
  const authToken = (req.body.authToken || "").trim();

  if (!email || !isValidUserSession(email, authToken)) {
    res.status(401).send("Please login first to delete requests");
    return;
  }

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).send("Invalid request");
    return;
  }

  getNoteRequestSchemaSupport((schemaErr, schema) => {
    if (schemaErr) {
      console.log(schemaErr);
      res.status(500).send("Delete failed");
      return;
    }

    if (!schema.hasUserEmail) {
      res.status(403).send("This request cannot be deleted because it has no owner saved");
      return;
    }

    db.query("DELETE FROM note_requests WHERE id=? AND user_email=?", [id, email], (err, result) => {
      if (err) {
        console.log(err);
        res.status(500).send("Delete failed");
        return;
      }

      if (result.affectedRows === 0) {
        res.status(403).send("You can only delete requests you created");
        return;
      }

      res.send("Request Deleted");
    });
  });
});

app.delete("/comment/:id", (req, res) => {
  const id = Number(req.params.id);
  const email = (req.body.email || "").trim();
  const authToken = (req.body.authToken || "").trim();

  if (!email || !isValidUserSession(email, authToken)) {
    res.status(401).send("Please login first to delete comments");
    return;
  }

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).send("Invalid comment");
    return;
  }

  getCommentSchemaSupport((schemaErr, schema) => {
    if (schemaErr) {
      console.log(schemaErr);
      res.status(500).send("Delete failed");
      return;
    }

    if (!schema.hasUserEmail) {
      res.status(403).send("This comment cannot be deleted because it has no owner saved");
      return;
    }

    db.query("DELETE FROM comments WHERE id=? AND user_email=?", [id, email], (err, result) => {
      if (err) {
        console.log(err);
        res.status(500).send("Delete failed");
        return;
      }

      if (result.affectedRows === 0) {
        res.status(403).send("You can only delete comments you created");
        return;
      }

      res.send("Comment Deleted");
    });
  });
});

app.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  const sql = "INSERT INTO users(name,email,password) VALUES (?,?,?)";
  db.query(sql, [name, email, password], (err) => {
    if (err) {
      console.log(err);
      res.send("Error: " + err.message);
    } else {
      res.send("User Registered");
    }
  });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM users WHERE email=? AND password=?";

  db.query(sql, [email, password], (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send("Login failed");
      return;
    }

    if (result.length > 0) {
      res.send({
        message: "Login Success",
        email: result[0].email,
        authToken: createUserSession(result[0].email)
      });
    } else {
      res.send("Invalid Login");
    }
  });
});

app.get("/profile/:email", (req, res) => {
  const email = (req.params.email || "").trim();
  const sql = "SELECT name,email FROM users WHERE email=?";

  db.query(sql, [email], (err, user) => {
    if (err) {
      console.log(err);
      res.status(500).send("Unable to load profile");
      return;
    }

    if (!user.length) {
      res.status(404).send("User not found");
      return;
    }

    const sql2 = "SELECT * FROM notes WHERE user_email=?";

    db.query(sql2, [email], (notesErr, notes) => {
      if (notesErr) {
        console.log(notesErr);
        res.status(500).send("Unable to load profile");
        return;
      }

      getNoteRequestSchemaSupport((requestSchemaErr, requestSchema) => {
        if (requestSchemaErr) {
          console.log(requestSchemaErr);
          res.status(500).send("Unable to load profile");
          return;
        }

        const loadComments = (requests) => {
          getCommentSchemaSupport((commentSchemaErr, commentSchema) => {
            if (commentSchemaErr) {
              console.log(commentSchemaErr);
              res.status(500).send("Unable to load profile");
              return;
            }

            if (!commentSchema.hasUserEmail) {
              res.send({
                user: user[0],
                notes: notes,
                requests: requests,
                comments: []
              });
              return;
            }

            const createdAtSelect = commentSchema.hasCreatedAt
              ? "comments.created_at"
              : "NULL AS created_at";
            const commentsSql = `
              SELECT
                comments.id,
                comments.note_id,
                comments.comment,
                comments.user_email,
                ${createdAtSelect},
                notes.title AS note_title
              FROM comments
              LEFT JOIN notes ON comments.note_id = notes.id
              WHERE comments.user_email=?
              ORDER BY comments.id DESC`;

            db.query(commentsSql, [email], (commentsErr, comments) => {
              if (commentsErr) {
                console.log(commentsErr);
                res.status(500).send("Unable to load profile");
                return;
              }

              res.send({
                user: user[0],
                notes: notes,
                requests: requests,
                comments: comments
              });
            });
          });
        };

        if (!requestSchema.hasUserEmail) {
          loadComments([]);
          return;
        }

        const titleParts = [];
        const detailsParts = [];

        if (requestSchema.hasTitle) {
          titleParts.push("NULLIF(TRIM(title), '')");
        }

        if (requestSchema.hasNeededNotes) {
          titleParts.push("NULLIF(TRIM(needed_notes), '')");
        }

        if (requestSchema.hasDetails) {
          detailsParts.push("NULLIF(TRIM(details), '')");
        }

        if (requestSchema.hasExtraDetails) {
          detailsParts.push("NULLIF(TRIM(extra_details), '')");
        }

        const titleSelect = `COALESCE(${titleParts.concat("'Untitled request'").join(", ")}) AS title`;
        const detailsSelect = detailsParts.length
          ? `COALESCE(${detailsParts.join(", ")}) AS details`
          : "'' AS details";
        const createdAtSelect = requestSchema.hasCreatedAt
          ? "created_at"
          : "NULL AS created_at";
        const requestsSql = `
          SELECT
            id,
            course,
            semester,
            subject,
            user_email,
            ${createdAtSelect},
            ${titleSelect},
            ${detailsSelect}
          FROM note_requests
          WHERE user_email=?
          ORDER BY id DESC`;

        db.query(requestsSql, [email], (requestsErr, requests) => {
          if (requestsErr) {
            console.log(requestsErr);
            res.status(500).send("Unable to load profile");
            return;
          }

          loadComments(requests);
        });
      });
    });
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
