from io import BytesIO
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from django.utils import timezone
from .contracts import FlowError
from .models import UserAvatar

MAX_UPLOAD = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000


def save_avatar(user, upload):
    if upload is None:
        raise FlowError("AVATAR_REQUIRED", "Выберите изображение", 400)
    if upload.size > MAX_UPLOAD:
        raise FlowError("AVATAR_TOO_LARGE", "Размер фото — не больше 5 МБ", 400)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(upload) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"}:
                    raise FlowError("AVATAR_FORMAT", "Выберите фото в формате JPG, PNG или WebP", 400)
                if original.width * original.height > MAX_PIXELS:
                    raise FlowError("AVATAR_DIMENSIONS", "Разрешение фото — не больше 16 мегапикселей", 400)
                original.load()
                image = ImageOps.fit(ImageOps.exif_transpose(original).convert("RGBA"), (384, 384), method=Image.Resampling.LANCZOS)
                # Re-encode actual decoded pixels; omit EXIF and other source metadata.
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                output = BytesIO()
                background.save(output, format="WEBP", quality=85)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise FlowError("AVATAR_FORMAT", "Не удалось открыть фото. Выберите корректный JPG, PNG или WebP", 400) from error
    UserAvatar.objects.update_or_create(user=user, defaults={"image": output.getvalue(), "updated_at": timezone.now()})
