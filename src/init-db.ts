// This script initializes the database by creating the schema and synchronizing the tables

import config from "./config";
import { AppDataSource, schema, MusicPost, User } from "./models";
import { hashPassword } from "./utils";
import initdata from "./spotify-init-data/data.json";
import fs from "fs";
import { uploadBase64ToObjectStorage } from "./objectstorage.service";
import path from "path";

export async function initializeDatabase() {
  console.log("Initializing database...");
  // connect to the database
  await AppDataSource.initialize();

  // create schema if it doesn't exist
  console.log(`Creating schema: ${schema}`);
  await AppDataSource.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  // synchronize the database schema
  // This will create the tables if they don't exist
  console.log("Synchronizing database schema...");
  await AppDataSource.synchronize();

  // create gin index for music_posts table
  // use for full-text search on the caption column
  await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS spotify_posts_search_vector_idx
        ON ${schema}.music_posts USING gin (to_tsvector('english', caption));
    `);

  // only for development purposes
  const repo = AppDataSource.getRepository(User);
  const adminUser = repo.create({
    username: config.ADMIN_USERNAME,
    email: "admin@admin.org",
    passwordHash: await hashPassword("admin123"),
    id: config.ADMIN_USER_ID, // Set a fixed ID for the admin user
  });
  await repo.save(adminUser);

  const guestUser = repo.create({
    username: config.GUEST_USERNAME,
    email: "guest@guest.org",
    passwordHash: await hashPassword("guest123"),
    id: config.GUEST_USER_ID, // Set a fixed ID for the guest user
  });
  await repo.save(guestUser);

  // init data
  for (var i = 0; i < initdata.length; i++) {
    const musicData = initdata[i];

    // may be jpg,png,jpeg
    // verify the file extension in the data.json file
    const exts = ["jpg", "jpeg", "png"];

    let imageBase64 = "";
    for (const ext of exts) {
      const filePath = path.join(__dirname, "spotify-init-data", `${i}.${ext}`);
      if (fs.existsSync(filePath)) {
        const imageBuffer = fs.readFileSync(filePath);
        imageBase64 = imageBuffer.toString("base64");
      }
    }

    if (!imageBase64) {
      console.warn(`No image found for music post ${i + 1}`);
      continue; // Skip this iteration if no image is found
    }
    const uploadResult = await uploadBase64ToObjectStorage(
      imageBase64,
      "image/jpeg"
    );
    const mp3Music = fs.readFileSync(
      path.join(__dirname, "spotify-init-data", `${i}.mp3`)
    );
    const uploadMusicResult = await uploadBase64ToObjectStorage(
      mp3Music.toString("base64"),
      "audio/mpeg"
    );
    const musicPost = AppDataSource.getRepository(MusicPost).create({
      userId: config.ADMIN_USER_ID, // Use the admin user for initial data
      coverImageUrl: uploadResult.objectUrl,
      audioUrl: uploadMusicResult.objectUrl,
      caption: musicData || "",
      createdAt: new Date(),
    });

    await AppDataSource.getRepository(MusicPost).save(musicPost);
    console.log(`Music Post ${i + 1} initialized: ${musicData}`);
  }
}
// This function will be called when the script is run
initializeDatabase()
  .then(() => {
    console.log("Database initialized successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error initializing database:", error);
    process.exit(1);
  });
