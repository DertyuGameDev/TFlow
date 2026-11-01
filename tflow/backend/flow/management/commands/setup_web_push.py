import base64
import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Create a persistent VAPID keypair without printing private material.'

    def add_arguments(self, parser):
        parser.add_argument('--private', required=True)
        parser.add_argument('--public', required=True)

    def handle(self, *args, **options):
        private, public = Path(options['private']), Path(options['public'])
        private.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if private.exists():
            key=serialization.load_pem_private_key(private.read_bytes(), password=None)
            if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
                raise RuntimeError('Existing VAPID key has an invalid type; it was not rotated')
        else:
            key=ec.generate_private_key(ec.SECP256R1())
            payload=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
            descriptor=os.open(private,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(descriptor,'wb') as stream:stream.write(payload)
        private.chmod(0o600)
        value=base64.urlsafe_b64encode(key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)).rstrip(b'=')
        if public.exists() and public.read_bytes().strip()!=value:
            raise RuntimeError('Existing VAPID public key does not match; refusing to rotate subscriptions')
        public.write_bytes(value+b'\n');public.chmod(0o644)
        self.stdout.write('VAPID keypair ready; private material is not printed')
