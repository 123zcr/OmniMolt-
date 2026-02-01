#!/usr/bin/env python3
"""
OmniParser API Server for Moltbot Integration
Provides a simple HTTP API to parse screenshots and identify UI elements.
"""

import os
import sys
import json
import base64
import io
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

import torch
from PIL import Image

# Global model instance
omniparser = None
device = None

def load_models():
    """Load OmniParser models"""
    global omniparser, device
    
    from util.omniparser import Omniparser  # Note: lowercase 'p'
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    
    # Model paths
    weights_dir = Path(__file__).parent / "weights"
    
    # Config dict for Omniparser
    config = {
        'som_model_path': str(weights_dir / "icon_detect" / "model.pt"),
        'caption_model_name': "florence2",
        'caption_model_path': str(weights_dir / "icon_caption"),
        'BOX_TRESHOLD': 0.05
    }
    
    omniparser = Omniparser(config)
    
    print("OmniParser models loaded successfully!")
    return omniparser

class OmniParserHandler(BaseHTTPRequestHandler):
    """HTTP request handler for OmniParser API"""
    
    def do_POST(self):
        """Handle POST requests"""
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
            
            if self.path == '/parse':
                result = self.handle_parse(data)
            elif self.path == '/health':
                result = {"status": "ok", "device": str(device)}
            else:
                result = {"error": f"Unknown endpoint: {self.path}"}
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
                return
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
    
    def do_GET(self):
        """Handle GET requests"""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok",
                "device": str(device),
                "model_loaded": omniparser is not None
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def handle_parse(self, data):
        """Parse an image and return UI elements"""
        global omniparser
        
        if omniparser is None:
            return {"error": "Models not loaded"}
        
        # Get image from request
        if 'image_base64' not in data:
            return {"error": "No image provided. Use 'image_base64'"}
        
        try:
            # Run OmniParser - it handles base64 internally
            # Returns: labeled_img (base64), label_coordinates (dict), filtered_boxes_elem (list of dicts)
            labeled_img, parsed_content_list = omniparser.parse(data['image_base64'])
            
            # Decode original image to get dimensions
            image_data = base64.b64decode(data['image_base64'])
            image = Image.open(io.BytesIO(image_data))
            img_width, img_height = image.size
            
            # Format results - parsed_content_list contains dicts with bbox info
            # Format: {'type': 'icon'/'text', 'bbox': [x1, y1, x2, y2], 'interactivity': bool, 'content': str, 'source': str}
            elements = []
            for i, item in enumerate(parsed_content_list):
                if isinstance(item, dict):
                    # New format with bbox information
                    bbox = item.get('bbox', [0, 0, 0, 0])
                    elements.append({
                        "id": i,
                        "content": {
                            "type": item.get('type', 'unknown'),
                            "bbox": bbox,  # normalized [x1, y1, x2, y2] in 0-1 range
                            "interactivity": item.get('interactivity', False),
                            "content": item.get('content', ''),
                            "source": item.get('source', ''),
                        }
                    })
                else:
                    # Legacy format - just a string
                    elements.append({
                        "id": i,
                        "content": str(item)
                    })
            
            return {
                "success": True,
                "image_size": {"width": img_width, "height": img_height},
                "element_count": len(elements),
                "elements": elements,
                "labeled_image": labeled_img  # Base64 encoded labeled image
            }
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"error": f"Parse failed: {str(e)}"}
    
    def log_message(self, format, *args):
        """Override to customize logging"""
        print(f"[OmniParser API] {args[0]}")

def main():
    """Start the OmniParser API server"""
    import argparse
    
    parser = argparse.ArgumentParser(description="OmniParser API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on")
    args = parser.parse_args()
    
    print("Loading OmniParser models...")
    try:
        load_models()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Failed to load models: {e}")
        print("Make sure you have downloaded the model weights to the 'weights' folder.")
        print("Run: huggingface-cli download microsoft/OmniParser-v2.0 --local-dir weights")
        sys.exit(1)
    
    server_address = (args.host, args.port)
    httpd = HTTPServer(server_address, OmniParserHandler)
    
    print(f"OmniParser API server running on http://{args.host}:{args.port}")
    print("Endpoints:")
    print("  POST /parse - Parse image and return UI elements")
    print("  GET  /health - Check server health")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        httpd.shutdown()

if __name__ == "__main__":
    main()
