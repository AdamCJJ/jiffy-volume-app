import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

export async function initDb() {
  // Render Postgres usually uses managed schema; you can run schema.sql manually once.
  // This file is kept simple on purpose.
}

export async function insertEstimate(row) {
  const {
    user_id,
    agent_label,
    job_type,
    dumpster_size,
    notes,
    photo_count,
    model_name,
    result_text,
    confidence
  } = row;

  const q = `
    insert into estimates
      (user_id, agent_label, job_type, dumpster_size, notes, photo_count, model_name, result_text, confidence)
    values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    returning id, created_at
  `;
  const vals = [user_id, agent_label, job_type, dumpster_size, notes, photo_count, model_name, result_text, confidence];
  const r = await pool.query(q, vals);
  return r.rows[0];
}

export async function listEstimates(limit = 100) {
  const r = await pool.query(
    `select id, created_at, agent_label, job_type, dumpster_size, photo_count, confidence,
            left(result_text, 180) as result_preview
     from estimates
     order by created_at desc
     limit $1`,
    [limit]
  );
  return r.rows;
}

export async function getEstimate(id) {
  const r = await pool.query(`select * from estimates where id = $1`, [id]);
  return r.rows[0] || null;
}
