const express = require('express');
const router = express.Router();

module.exports = ({ supabaseAdmin, supabaseUrl }) => {
  // GET /albums
  router.get('/', async (req, res) => {
    console.log('[albums] GET /albums');
    try {
      const { data: albums, error } = await supabaseAdmin.from('albums').select('id, name');
      if (error) {
        console.error('[albums] error fetching albums:', error);
        return res.status(500).json({ message: 'Error al obtener álbumes.', error: error.message });
      }
      res.json({ message: 'Álbumes obtenidos exitosamente.', albums });
    } catch (err) {
      console.error('[albums] unexpected error:', err);
      res.status(500).json({ message: 'Error interno al obtener álbumes.' });
    }
  });

  // GET /albums/:albumId/photos
  router.get('/:albumId/photos', async (req, res) => {
    const albumId = req.params.albumId;
    console.log('[albums] GET /albums/:albumId/photos', { albumId });
    if (!albumId || !/^[0-9a-fA-F-]{36}$/.test(albumId)) return res.status(400).json({ message: 'ID de álbum no válido.' });
    try {
      const { data: photos, error } = await supabaseAdmin.from('photos').select('id, watermarked_file_path, student_code, price, metadata').eq('album_id', albumId);
      if (error) {
        console.error('[albums] error fetching photos for album:', albumId, error);
        return res.status(500).json({ message: 'Error al obtener fotos.', error: error.message });
      }
      if (!photos || photos.length === 0) return res.status(404).json({ message: 'No se encontraron fotos para este álbum.' });
      const photosWithPublicUrls = photos.map((photo) => ({
        ...photo,
        public_watermarked_url: `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${photo.watermarked_file_path}`,
      }));
      res.json({ message: `Fotos obtenidas exitosamente para el álbum ${albumId}.`, photos: photosWithPublicUrls });
    } catch (err) {
      console.error('[albums] unexpected error fetching photos:', err);
      res.status(500).json({ message: 'Error interno al obtener fotos.' });
    }
  });

  return router;
};
