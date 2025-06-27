import axios from "axios";
import * as cheerio from "cheerio";
import { v1_base_url } from "../utils/base_v1.js";

/**
 * Fetch internal ID from AniList ID using the AniList API and title search
 * @param {number|string} anilistId - The AniList ID to convert
 * @returns {Promise<string|null>} - The internal ID or null if not found
 */
export async function getInternalIdFromAnilistId(anilistId) {
  try {
    // Step 1: Get anime details from AniList API
    const anilistQuery = `
      query {
        Media(id: ${anilistId}, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          synonyms
        }
      }
    `;

    const anilistResponse = await axios.post('https://graphql.anilist.co', {
      query: anilistQuery
    });

    if (!anilistResponse.data?.data?.Media) {
      console.error("AniList API returned no data for ID:", anilistId);
      return null;
    }

    const animeData = anilistResponse.data.data.Media;
    
    // Step 2: Try to search using the English title, then romaji if English not available
    const searchTitle = animeData.title.english || animeData.title.romaji;
    
    // Step 3: Search on the website using the title
    const searchUrl = `https://${v1_base_url}/search?keyword=${encodeURIComponent(searchTitle)}`;
    const { data } = await axios.get(searchUrl);
    const $ = cheerio.load(data);
    
    // Look for the first anime result
    const animeItems = $('.flw-item');
    
    for (let i = 0; i < animeItems.length; i++) {
      const item = animeItems.eq(i);
      const title = item.find('.film-detail .film-name').text().trim();
      const link = item.find('.film-poster').attr('href');
      
      // Check if the title is a reasonable match
      if (isReasonableMatch(title, searchTitle, animeData.synonyms)) {
        // Extract ID from URL path
        const internalId = link.split('/').pop();
        return internalId;
      }
    }
    
    // If we still don't have a match, try with romaji title as fallback
    if (searchTitle !== animeData.title.romaji) {
      const fallbackSearchUrl = `https://${v1_base_url}/search?keyword=${encodeURIComponent(animeData.title.romaji)}`;
      const fallbackData = await axios.get(fallbackSearchUrl);
      const $fallback = cheerio.load(fallbackData.data);
      
      const fallbackItems = $fallback('.flw-item');
      
      for (let i = 0; i < fallbackItems.length; i++) {
        const item = fallbackItems.eq(i);
        const title = item.find('.film-detail .film-name').text().trim();
        const link = item.find('.film-poster').attr('href');
        
        if (isReasonableMatch(title, animeData.title.romaji, animeData.synonyms)) {
          return link.split('/').pop();
        }
      }
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

/**
 * Helper function to determine if two titles are a reasonable match
 * @param {string} title1 - First title
 * @param {string} title2 - Second title
 * @param {string[]} synonyms - Array of synonyms for title2
 * @returns {boolean} - True if titles are a reasonable match
 */
function isReasonableMatch(title1, title2, synonyms = []) {
  if (!title1 || !title2) return false;
  
  // Normalize titles for comparison
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const normalizedTitle1 = normalize(title1);
  const normalizedTitle2 = normalize(title2);
  
  // Direct match
  if (normalizedTitle1 === normalizedTitle2) return true;
  
  // Check if title1 contains title2 or vice versa
  if (normalizedTitle1.includes(normalizedTitle2) || normalizedTitle2.includes(normalizedTitle1)) return true;
  
  // Check against synonyms
  if (synonyms && synonyms.length > 0) {
    for (const synonym of synonyms) {
      const normalizedSynonym = normalize(synonym);
      if (normalizedTitle1 === normalizedSynonym || normalizedTitle1.includes(normalizedSynonym) || normalizedSynonym.includes(normalizedTitle1)) {
        return true;
      }
    }
  }
  
  return false;
} 
