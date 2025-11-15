const express = require('express');
const router = express.Router();

module.exports = ({ supabaseAdmin, supabaseUrl, upload, sharp, path, fs }) => {
  // create album
  router.post('/albums', async (req, res) => {
    const { name, event_date } = req.body;
    console.log('[admin] POST /admin/albums payload:', { name, event_date });
    const photographer_user_id = '65805569-2e32-46a0-97c5-c52e31e02866';
    if (!name) return res.status(400).json({ message: 'El nombre del álbum es requerido.' });
    if (!event_date) return res.status(400).json({ message: 'La fecha del evento es requerida para el álbum.' });
    try {
      const { data: album, error } = await supabaseAdmin.from('albums').insert({ name, event_date, photographer_user_id }).select().single();
      if (error) {
        console.error('[admin] error inserting album:', error);
        return res.status(500).json({ message: 'Error al crear álbum.', error: error.message });
      }
      res.status(201).json({ message: 'Álbum creado exitosamente.', album });
    } catch (err) {
      console.error('[admin] unexpected error creating album:', err);
      res.status(500).json({ message: 'Error interno al crear álbum.' });
    }
  });

  // upload photos
  router.post('/upload-photos/:albumId', upload.array('photos'), async (req, res) => {
    const albumId = req.params.albumId;
    console.log('[admin] POST /admin/upload-photos', { albumId, files: req.files?.length || 0 });
    const photographerId = '65805569-2e32-46a0-97c5-c52e31e02866';
    if (!albumId || !/^[0-9a-fA-F-]{36}$/.test(albumId)) return res.status(400).json({ message: 'ID de álbum no válido.' });

    try {
      const { data: album, error: albumError } = await supabaseAdmin.from('albums').select('id, photographer_user_id').eq('id', albumId).eq('photographer_user_id', photographerId).single();
      if (albumError || !album) {
        console.error('[admin] album not found or unauthorized:', albumError?.message);
        return res.status(404).json({ message: 'Álbum no encontrado o no autorizado.' });
      }
    } catch (dbError) {
      console.error('[admin] error verifying album:', dbError);
      return res.status(500).json({ message: 'Error interno' });
    }

    if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No se subieron archivos.' });

    const results = [];
    const watermarkedPhotosPath = path.resolve(__dirname, '..', '..', 'assets', 'watermark.png');
    if (!fs.existsSync(watermarkedPhotosPath)) {
      console.error('[admin] watermark file not found at', watermarkedPhotosPath);
      return res.status(500).json({ message: 'Marca de agua no encontrada.' });
    }

    for (const file of req.files) {
      try {
        const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${path.extname(file.originalname)}`;
        const originalFilePath = `albums/${albumId}/original/${uniqueFileName}`;
        const watermarkedFilePath = `albums/${albumId}/watermarked/${uniqueFileName}`;

        const { error: uploadOriginalError } = await supabaseAdmin.storage.from('original-photos').upload(originalFilePath, file.buffer, { contentType: file.mimetype, upsert: false });
        if (uploadOriginalError) throw new Error(uploadOriginalError.message);

        const watermarkBuffer = await sharp(watermarkedPhotosPath).resize({ width: 200 }).toBuffer();
        const watermarkedBuffer = await sharp(file.buffer).composite([{ input: watermarkBuffer, gravity: 'center' }]).toFormat('jpeg', { quality: 80 }).toBuffer();

        const { error: uploadWatermarkedError } = await supabaseAdmin.storage.from('watermarked-photos').upload(watermarkedFilePath, watermarkedBuffer, { contentType: 'image/jpeg', upsert: false });
        if (uploadWatermarkedError) throw new Error(uploadWatermarkedError.message);

        const publicWatermarkedUrl = `${supabaseUrl}/storage/v1/object/public/watermarked-photos/${watermarkedFilePath}`;
        const { data: photoDbData, error: dbInsertError } = await supabaseAdmin.from('photos').insert([{ album_id: albumId, original_file_path: originalFilePath, watermarked_file_path: watermarkedFilePath, student_code: null, price: 15.0, metadata: { originalName: file.originalname, mimetype: file.mimetype, size: file.size } }]).select().single();
        if (dbInsertError) throw new Error(dbInsertError.message);

        results.push({ originalName: file.originalname, status: 'success', photoId: photoDbData.id, publicWatermarkedUrl });
      } catch (error) {
        console.error('[admin] Error processing file', file.originalname, error);
        results.push({ originalName: file.originalname, status: 'failed', error: error.message });
      }
    }

    res.json({ message: 'Proceso completado', results });
  });

  // delete album, delete photo, update album etc could be added here likewise

  return router;
};
