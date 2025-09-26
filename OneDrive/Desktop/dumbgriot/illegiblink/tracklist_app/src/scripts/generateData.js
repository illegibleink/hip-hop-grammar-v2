require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');

// Load tracklists.json
let rawData;
try {
  rawData = JSON.parse(fs.readFileSync('./data/tracklists.json'));
} catch (error) {
  console.error('Error reading tracklists.json:', error);
  process.exit(1);
}

// Validate and sanitize data
const sets = {};
rawData.tracklists.forEach((set, index) => {
  const setId = `set${index + 1}`;
  if (!set || !Array.isArray(set.tracks) || set.tracks.length === 0) {
    console.warn(`Skipping invalid set at index ${index}`);
    return;
  }
  // Check for duplicate tracks
  const trackNames = new Set();
  const uniqueTracks = set.tracks.filter((track, trackIndex) => {
    if (!track.name || trackNames.has(track.name)) {
      console.warn(`Duplicate or invalid track in ${setId}: ${track.name || 'unnamed'}`);
      return false;
    }
    trackNames.add(track.name);
    return true;
  });
  sets[setId] = {
    name: set.name || `#${index + 1}`,
    price: typeof set.price === 'number' ? set.price : (index < 12 ? 0 : 10.0),
    tracks: uniqueTracks.map((track, trackIndex) => ({
      name: track.name || `Track ${index + 1}-${trackIndex + 1}`,
      artists: Array.isArray(track.artists) ? track.artists : ['Unknown Artist'],
      spotify_id: track.spotify_id || `spotify_${index + 1}_${trackIndex}`,
      recording_mbid: track.recording_mbid || `mbid_${index + 1}_${trackIndex}`,
      isrc: track.isrc || `isrc_${index + 1}_${trackIndex}`,
      release_date: track.release_date && !isNaN(Date.parse(track.release_date)) ? track.release_date : '1989-01-01',
      genre: Array.isArray(track.genre) && track.genre.length > 0 ? track.genre[0] : 'Unknown'
    }))
  };
});

// Remove invalid sets
Object.keys(sets).forEach(setId => {
  if (!sets[setId].tracks.length) {
    console.warn(`Removing set with no tracks: ${setId}`);
    delete sets[setId];
  }
});

const algorithm = 'aes-256-cbc';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv(algorithm, key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify({ tracklists: Object.values(sets) })), cipher.final()]);
fs.writeFileSync('./data/tracks.json.enc', Buffer.concat([iv, encrypted]));
console.log('Encrypted tracklists.json generated as tracks.json.enc');