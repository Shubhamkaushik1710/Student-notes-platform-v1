const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mysql = require("mysql2");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

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
      title VARCHAR(255) NOT NULL,
      course VARCHAR(100) DEFAULT '',
      semester VARCHAR(100) DEFAULT '',
      subject VARCHAR(150) DEFAULT '',
      details TEXT,
      user_email VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_note_requests_created_at (created_at),
      INDEX idx_note_requests_user_email (user_email)
    )`;

  db.query(createDownloadTableSql, (err) => {
    if (err) {
      console.log("Unable to ensure note_downloads table", err);
    }
  });

  db.query(createNoteRequestsTableSql, (err) => {
    if (err) {
      console.log("Unable to ensure note_requests table", err);
    }
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

let noteSchemaSupport = null;

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
  const sql = `
    SELECT
      note_requests.*,
      COALESCE(NULLIF(TRIM(users.name), ''), note_requests.user_email) AS requester_name
    FROM note_requests
    LEFT JOIN users ON note_requests.user_email = users.email
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

  const sql = `
    INSERT INTO note_requests(title,course,semester,subject,details,user_email)
    VALUES (?,?,?,?,?,?)`;

  db.query(sql, [title, course, semester, subject, details, email], (err) => {
    if (err) {
      console.log(err);
      res.status(500).send("Request failed");
      return;
    }

    res.send("Request added");
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
  const { note_id, comment } = req.body;
  const sql = "INSERT INTO comments(note_id,comment) VALUES (?,?)";

  db.query(sql, [note_id, comment], () => {
    res.send("Comment Added");
  });
});

app.get("/comments/:id", (req, res) => {
  const id = req.params.id;
  const sql = "SELECT * FROM comments WHERE note_id=?";

  db.query(sql, [id], (err, result) => {
    res.send(result);
  });
});

app.get("/download/:file", (req, res) => {
  const fileName = path.basename(req.params.file);
  const noteId = Number(req.query.noteId);
  const filePath = path.join(__dirname, "uploads", fileName);

  function sendFile() {
    res.download(filePath, fileName, (err) => {
      if (err && !res.headersSent) {
        console.log(err);
        res.status(500).send("Download failed");
      }
    });
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

app.delete("/delete/:id", (req, res) => {
  const id = req.params.id;
  db.query("DELETE FROM note_downloads WHERE note_id=?", [id], (downloadErr) => {
    if (downloadErr) {
      console.log(downloadErr);
      res.send("Delete failed");
      return;
    }

    db.query("DELETE FROM likes WHERE note_id=?", [id], (likesErr) => {
      if (likesErr) {
        console.log(likesErr);
        res.send("Delete failed");
        return;
      }

      db.query("DELETE FROM comments WHERE note_id=?", [id], (commentsErr) => {
        if (commentsErr) {
          console.log(commentsErr);
          res.send("Delete failed");
          return;
        }

        db.query("DELETE FROM notes WHERE id=?", [id], (noteErr) => {
          if (noteErr) {
            console.log(noteErr);
            res.send("Delete failed");
            return;
          }
          res.send("Note Deleted");
        });
      });
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
    if (result.length > 0) {
      res.send("Login Success");
    } else {
      res.send("Invalid Login");
    }
  });
});

app.get("/profile/:email", (req, res) => {
  const email = req.params.email;
  const sql = "SELECT name,email FROM users WHERE email=?";

  db.query(sql, [email], (err, user) => {
    const sql2 = "SELECT * FROM notes WHERE user_email=?";

    db.query(sql2, [email], (notesErr, notes) => {
      res.send({
        user: user[0],
        notes: notes
      });
    });
  });
});

const PORT = process.env.PORT || 3000;

// Note request table
db.query(`CREATE TABLE IF NOT EXISTS note_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  needed_notes VARCHAR(200),
  course VARCHAR(50),
  semester VARCHAR(50),
  subject VARCHAR(100),
  extra_details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, (err) => { if(err) console.log(err); });

// Submit note request
app.post("/note-request", (req, res) => {
  const { needed_notes, course, semester, subject, extra_details } = req.body;
  const sql = "INSERT INTO note_requests(needed_notes,course,semester,subject,extra_details) VALUES (?,?,?,?,?)";
  db.query(sql, [needed_notes, course, semester, subject, extra_details], (err) => {
    if (err) { console.log(err); res.send("Request failed"); }
    else { res.send("Request submitted"); }
  });
});

// Get all note requests
app.get("/note-requests", (req, res) => {
  db.query("SELECT * FROM note_requests ORDER BY id DESC", (err, result) => {
    if (err) { res.send(err); }
    else { res.send(result); }
  });
});


app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
