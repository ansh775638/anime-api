import axios from "axios";
import * as cheerio from "cheerio";
import { v1_base_url } from "../utils/base_v1.js";

// In-memory cache for AniList ID to internal ID mappings
// This could be moved to a database in a production environment
const ANILIST_ID_CACHE = new Map();

/**
 * Fetch internal ID from AniList ID using the AniList GraphQL API
 * @param {number|string} anilistId - The AniList ID to convert
 * @returns {Promise<string|null>} - The internal ID or null if not found
 */
export async function getInternalIdFromAnilistId(anilistId) {
  try {
    // First check our cache
    if (ANILIST_ID_CACHE.has(anilistId)) {
      console.log(`Using cached mapping for AniList ID ${anilistId}: ${ANILIST_ID_CACHE.get(anilistId)}`);
      return ANILIST_ID_CACHE.get(anilistId);
    }

    // Get anime details from AniList API
    const anilistQuery = `
      query {
        Media(id: ${anilistId}, type: ANIME) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          format
          status
          episodes
          duration
          seasonYear
          season
          genres
          synonyms
        }
      }
    `;

    console.log(`Querying AniList API for ID: ${anilistId}`);
    const anilistResponse = await axios.post('https://graphql.anilist.co', {
      query: anilistQuery
    });

    if (!anilistResponse.data?.data?.Media) {
      console.error("AniList API returned no data for ID:", anilistId);
      return null;
    }

    const animeData = anilistResponse.data.data.Media;
    console.log(`AniList API returned information for "${animeData.title.english || animeData.title.romaji}"`);

    // Prepare all possible search terms
    const searchTerms = [
      animeData.title.english,
      animeData.title.romaji,
      ...(animeData.synonyms || [])
    ].filter(Boolean);

    // If we have a MAL ID, add that to our search options
    const malId = animeData.idMal;
    
    // Try to find the anime using each search term
    for (const term of searchTerms) {
      const encodedTerm = encodeURIComponent(term);
      const searchUrl = `https://${v1_base_url}/search?keyword=${encodedTerm}`;
      
      console.log(`Searching for "${term}" at: ${searchUrl}`);
      const { data } = await axios.get(searchUrl);
      const $ = cheerio.load(data);
      
      const animeItems = $('.flw-item');
      const resultCount = animeItems.length;
      
      if (resultCount > 0) {
        console.log(`Found ${resultCount} results for "${term}"`);
        
        // Extract all found titles for comparison
        const foundAnimes = [];
        animeItems.each((i, el) => {
          const title = $(el).find('.film-detail .film-name').text().trim();
          const link = $(el).find('.film-poster').attr('href');
          if (link) {
            const id = link.split('/').pop();
            foundAnimes.push({ title, id });
          }
        });
        
        // Try to find the best match
        for (const anime of foundAnimes) {
          if (isReasonableMatch(anime.title, term)) {
            console.log(`Found matching anime: "${anime.title}" with ID: ${anime.id}`);
            
            // Store in cache for future use
            ANILIST_ID_CACHE.set(anilistId, anime.id);
            
            return anime.id;
          }
        }
        
        // If no good match, just return the first result
        if (foundAnimes.length > 0) {
          console.log(`No exact match found, using first result: "${foundAnimes[0].title}" with ID: ${foundAnimes[0].id}`);
          
          // Store in cache for future use
          ANILIST_ID_CACHE.set(anilistId, foundAnimes[0].id);
          
          return foundAnimes[0].id;
        }
      }
    }
    
    // If we reach here, we couldn't find any matches
    console.log(`No results found for AniList ID: ${anilistId}`);
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
 * @returns {boolean} - True if titles are a reasonable match
 */
function isReasonableMatch(title1, title2) {
  if (!title1 || !title2) return false;
  
  // Normalize titles for comparison
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const normalizedTitle1 = normalize(title1);
  const normalizedTitle2 = normalize(title2);
  
  // Direct match
  if (normalizedTitle1 === normalizedTitle2) return true;
  
  // Check if title1 contains title2 or vice versa
  if (normalizedTitle1.includes(normalizedTitle2) || normalizedTitle2.includes(normalizedTitle1)) return true;
  
  // Calculate similarity score (basic implementation)
  const longerLength = Math.max(normalizedTitle1.length, normalizedTitle2.length);
  if (longerLength === 0) return true;
  
  // Calculate Levenshtein distance
  const distance = levenshteinDistance(normalizedTitle1, normalizedTitle2);
  const similarityScore = (longerLength - distance) / longerLength;
  
  // Consider a match if similarity is high enough
  return similarityScore > 0.7;
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Levenshtein distance
 */
function levenshteinDistance(str1, str2) {
  const track = Array(str2.length + 1).fill(null).map(() => 
    Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator, // substitution
      );
    }
  }
  
  return track[str2.length][str1.length];
} 
