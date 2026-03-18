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
}
});

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
const sql = "SELECT * FROM notes";

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

app.delete("/delete/:id", (req, res) => {
const id = req.params.id;
const sql = "DELETE FROM notes WHERE id=?";

db.query(sql, [id], () => {
res.send("Note Deleted");
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