import axios from "axios";
import * as cheerio from "cheerio";
import { v1_base_url } from "../utils/base_v1.js";

/**
 * Fetch internal ID from AniList ID
 * @param {number|string} anilistId - The AniList ID to convert
 * @returns {Promise<string|null>} - The internal ID or null if not found
 */
export async function getInternalIdFromAnilistId(anilistId) {
  try {
    // First, try to search by AniList ID on the website
    const searchUrl = `https://${v1_base_url}/filter?keyword=&anilist_id=${anilistId}`;
    const { data } = await axios.get(searchUrl);
    const $ = cheerio.load(data);
    
    // Look for the first anime result
    const firstAnimeLink = $(".flw-item .film-poster").first().attr("href");
    
    if (firstAnimeLink) {
      // Extract ID from URL path
      const internalId = firstAnimeLink.split("/").pop();
      return internalId;
    }
    
    return null;
  } catch (error) {
    console.error("Error fetching internal ID from AniList ID:", error);
    return null;
  }
}

/**
 * Check if a string is an AniList ID (numeric only)
 * @param {string} id - The ID to check
 * @returns {boolean} - True if the ID is likely an AniList ID
 */
export function isAnilistId(id) {
  return /^\d+$/.test(id);
} 
