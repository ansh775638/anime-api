import extractEpisodesList from "../extractors/episodeList.extractor.js";
import { getCachedData, setCachedData } from "../helper/cache.helper.js";
import { getInternalIdFromAnilistId, isAnilistId } from "../helper/anilistMapper.helper.js";

export const getEpisodes = async (req, res) => {
  const { id } = req.params;
  // const cacheKey = `episodes_${id}`;
  
  try {
    let internalId = id;
    let isAnilist = false;
    
    // Check if this is an AniList ID (numeric only)
    if (isAnilistId(id)) {
      isAnilist = true;
      console.log(`Processing request for AniList ID: ${id}`);
      
      // Convert AniList ID to internal ID
      const mappedId = await getInternalIdFromAnilistId(id);
      
      if (!mappedId) {
        console.error(`No anime found with AniList ID: ${id}`);
        return { 
          success: false, 
          message: `No anime found with AniList ID: ${id}. The anime might not be available on this source.` 
        };
      }
      
      console.log(`AniList ID ${id} mapped to internal ID: ${mappedId}`);
      internalId = mappedId;
    }
    
    // const cachedResponse = await getCachedData(cacheKey);
    // if (cachedResponse && Object.keys(cachedResponse).length > 0) {
    //   return cachedResponse;
    // }
    
    console.log(`Fetching episodes for ID: ${internalId}`);
    const data = await extractEpisodesList(encodeURIComponent(internalId));
    
    if (!data || (Array.isArray(data) && data.length === 0) || 
        (typeof data === 'object' && Object.keys(data).length === 0)) {
      console.error(`No episodes found for ID: ${internalId}`);
      return {
        success: false,
        message: isAnilist 
          ? `Episodes not found for AniList ID: ${id} (mapped to internal ID: ${internalId})`
          : `Episodes not found for ID: ${id}`
      };
    }
    
    // If this was an AniList ID request, make sure to include it in the response
    if (isAnilist && !data.anilistId) {
      data.anilistId = parseInt(id);
    }
    
    // setCachedData(cacheKey, data).catch((err) => {
    //   console.error("Failed to set cache:", err);
    // });
    
    // Format the response to include a success field
    return {
      success: true,
      results: data
    };
  } catch (e) {
    console.error("Error fetching episodes:", e);
    return {
      success: false,
      message: e.message || "An error occurred while fetching episodes"
    };
  }
};
