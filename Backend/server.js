const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mysql = require("mysql2");
const path = require("path");

const app = express();

// app.use(cors());
app.use(cors({
  origin: "https://note-sharing-platform.netlify.app"
}));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// const db = mysql.createConnection({
// host: process.env.DB_HOST,
// user: process.env.DB_USER,
// password: process.env.DB_PASSWORD,
// database: process.env.DB_NAME
// });

const db = mysql.createConnection(process.env.MYSQL_URL);

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

db.query(createDownloadTableSql, (err) => {
if (err) {
console.log("Unable to ensure note_downloads table", err);
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
COALESCE(users.name, notes.user_email, 'Unknown user') AS uploader_name,
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
      console.log(err)  // ← yeh add karo
      res.send("Error: " + err.message)  // ← exact error bhejo
    } else {
      res.send("User Registered")
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




// app.listen(5000, () => {
// console.log("Server running on port 5000");
// });


const PORT = process.env.PORT || 3000;

app.listen(PORT,() => {
  console.log("server running on port" + PORT);
});
