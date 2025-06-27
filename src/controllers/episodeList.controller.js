import axios from "axios";
import * as cheerio from "cheerio";
import extractEpisodesList from "../extractors/episodeList.extractor.js";
import { v1_base_url } from "../utils/base_v1.js";

// In-memory cache for AniList ID to internal ID mappings
const ANILIST_CACHE = new Map();

// Direct mapping for highly popular anime to ensure reliability
const ANILIST_ID_MAPPING = {
  "21": "one-piece-100", // One Piece
  "1": "cowboy-bebop", // Cowboy Bebop
  "5": "naruto", // Naruto
  "16498": "attack-on-titan", // Attack on Titan
  "101922": "demon-slayer-kimetsu-no-yaiba", // Demon Slayer
  "97938": "my-hero-academia", // My Hero Academia
  "1535": "death-note", // Death Note
  "113415": "jujutsu-kaisen", // Jujutsu Kaisen
  "20": "naruto-shippuden", // Naruto Shippuden
  "9253": "steins-gate", // Steins;Gate
  "11061": "hunter-x-hunter-2011", // Hunter x Hunter (2011)
  "30276": "one-punch-man", // One Punch Man
  "124": "fushigi-yuugi-eikoden", // Fushigi Yuugi: Eikoden
  // Add more popular anime mappings here
};

/**
 * Cleanses a title by normalizing it for comparison purposes.
 * 
 * @param {string} title - The title to be cleansed
 * @returns {string} - The cleansed title
 */
function cleanseTitle(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^\w\s]/gi, '') // Remove special characters
    .replace(/\s+/g, ' ')     // Replace multiple spaces with a single space
    .trim();                  // Remove leading/trailing spaces
}

/**
 * Get AniList anime info using their GraphQL API
 * 
 * @param {string} id - AniList ID of the anime
 * @returns {Promise<Object>} - Anime information from AniList
 */
async function getAniListInfo(id) {
  try {
    const query = `
      query ($id: Int) {
        Media (id: $id, type: ANIME) {
          id
          title {
            romaji
            english
            native
            userPreferred
          }
          synonyms
          format
          status
          description
          season
          seasonYear
          episodes
        }
      }
    `;

    const variables = { id: parseInt(id) };
    
    const response = await axios.post('https://graphql.anilist.co', {
      query,
      variables
    });

    return response.data?.data?.Media;
  } catch (error) {
    console.error(`Error fetching AniList info for ID ${id}:`, error);
    return null;
  }
}

/**
 * Calculates the similarity between two strings using a simplified approach.
 * Returns a score between 0 and 1, with 1 being a perfect match.
 * 
 * @param {string} str1 - First string to compare
 * @param {string} str2 - Second string to compare
 * @returns {number} - Similarity score (0-1)
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = cleanseTitle(str1);
  const s2 = cleanseTitle(str2);
  
  // If exact match, return 1
  if (s1 === s2) return 1;
  
  // If one is a substring of the other, higher similarity
  if (s1.includes(s2) || s2.includes(s1)) {
    const longerLength = Math.max(s1.length, s2.length);
    const shorterLength = Math.min(s1.length, s2.length);
    return shorterLength / longerLength * 0.9; // 0.9 factor for not being exact match
  }
  
  // Check for word overlap
  const words1 = s1.split(' ').filter(word => word.length > 2); // Only consider words with 3+ chars
  const words2 = s2.split(' ').filter(word => word.length > 2);
  
  let matchCount = 0;
  for (const word of words1) {
    if (words2.includes(word)) {
      matchCount++;
    }
  }
  
  // Calculate word match score
  const maxWords = Math.max(words1.length, words2.length);
  return maxWords > 0 ? matchCount / maxWords * 0.8 : 0; // 0.8 factor for word-level match
}

/**
 * Attempts to find the internal ID for an anime based on title matching
 * 
 * @param {Array<string>} titleVariations - Different forms of the title to search for
 * @returns {Promise<string|null>} - The internal ID if found, null otherwise
 */
async function findInternalIdByTitleSearch(titleVariations) {
  try {
    // Ensure we have valid title variations to search for
    const validTitles = titleVariations.filter(title => title && typeof title === 'string');
    if (validTitles.length === 0) {
      return null;
    }

    // Try exact matches first (with some basic normalization)
    for (const title of validTitles) {
      // Create a search-friendly version of the title
      const searchTitle = encodeURIComponent(title.trim());
      
      // Search on the anime site
      const searchResponse = await axios.get(`${v1_base_url}/search?keyword=${searchTitle}`);
      const $ = cheerio.load(searchResponse.data);
      
      // Extract search results
      const searchResults = [];
      $('.film_list-wrap .flw-item').each((index, element) => {
        const titleElement = $(element).find('.film-detail .film-name a');
        const resultTitle = titleElement.text().trim();
        const resultUrl = titleElement.attr('href');
        
        // Extract ID from URL (format: /anime/anime-slug)
        let internalId = null;
        if (resultUrl) {
          const match = resultUrl.match(/\/anime\/([^/]+)/);
          if (match && match[1]) {
            internalId = match[1];
          }
        }
        
        if (internalId && resultTitle) {
          searchResults.push({
            title: resultTitle,
            internalId,
            similarity: calculateSimilarity(title, resultTitle)
          });
        }
      });
      
      // Sort by similarity
      searchResults.sort((a, b) => b.similarity - a.similarity);
      
      // If we have a high confidence match (similarity > 0.7), use it
      if (searchResults.length > 0 && searchResults[0].similarity > 0.7) {
        console.log(`Found match for "${title}": ${searchResults[0].title} (${searchResults[0].internalId}) with similarity ${searchResults[0].similarity}`);
        return searchResults[0].internalId;
      }
    }
    
    // If we reach here, we couldn't find a high-confidence match
    return null;
  } catch (error) {
    console.error("Error in title search:", error);
    return null;
  }
}

/**
 * Find the internal ID corresponding to an AniList ID
 * 
 * @param {string} anilistId - The AniList ID to find mapping for
 * @returns {Promise<string|null>} - The internal ID if found, null otherwise
 */
async function findInternalIdFromAnilist(anilistId) {
  try {
    // Step 1: Check direct mapping table
    if (ANILIST_ID_MAPPING[anilistId]) {
      console.log(`Using direct mapping for AniList ID ${anilistId}: ${ANILIST_ID_MAPPING[anilistId]}`);
      return ANILIST_ID_MAPPING[anilistId];
    }

    // Step 2: Check cache
    if (ANILIST_CACHE.has(anilistId)) {
      console.log(`Using cached mapping for AniList ID ${anilistId}: ${ANILIST_CACHE.get(anilistId)}`);
      return ANILIST_CACHE.get(anilistId);
    }

    // Step 3: Get info from AniList API
    const anilistInfo = await getAniListInfo(anilistId);
    if (!anilistInfo) {
      return null;
    }

    // Step 4: Collect all possible title variations for searching
    const titleVariations = [
      anilistInfo.title.english,
      anilistInfo.title.romaji,
      anilistInfo.title.userPreferred,
      ...(anilistInfo.synonyms || [])
    ].filter(Boolean); // Remove any undefined/null titles

    // Step 5: Try to find a match based on title
    const internalId = await findInternalIdByTitleSearch(titleVariations);
    
    // Step 6: If found, cache for future use
    if (internalId) {
      ANILIST_CACHE.set(anilistId, internalId);
      console.log(`Mapped AniList ID ${anilistId} to internal ID ${internalId} (cached for future use)`);
    }

    return internalId;
  } catch (error) {
    console.error(`Error mapping AniList ID ${anilistId}:`, error);
    return null;
  }
}

/**
 * Controller to get episode list by AniList ID
 */
export const getEpisodesByAnilistId = async (req, res) => {
  try {
    const anilistId = req.params.id;
    
    if (!anilistId) {
      return res.status(400).json({ 
        success: false, 
        message: "AniList ID is required" 
      });
    }

    // Find the internal ID that corresponds to this AniList ID
    const internalId = await findInternalIdFromAnilist(anilistId);

    if (!internalId) {
      return res.json({
        success: true,
        results: {
          success: false,
          message: `AniList ID ${anilistId} could not be found in our system. The anime might not be available on our source.`
        }
      });
    }

    // Use the internal ID to get the episode list
    const animeUrl = `${v1_base_url}/watch/${internalId}`;
    const response = await axios.get(animeUrl);
    const $ = cheerio.load(response.data);
    
    const episodesList = await extractEpisodesList($, internalId);

    return res.json({
      success: true,
      results: {
        success: true,
        anilistId,
        internalId,
        episodes: episodesList
      }
    });

  } catch (error) {
    console.error("Error in getEpisodesByAnilistId:", error);
    return res.status(500).json({
      success: false,
      error: "An error occurred while fetching the episodes"
    });
  }
};

export default {
  getEpisodesByAnilistId
};
