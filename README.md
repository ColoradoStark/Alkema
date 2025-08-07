# Alkema

Alkema is an open-source online browser game in early development, built using LPC assets.  It includes the [LPC SpriteSheet Character Generator](Universal-LPC-Spritesheet-Character-Generator/README.md) and other will also include other LPC (Liberated Pixel Cup) tilesets and interiors.

## Project Status

The project is in its early stages. Currently, Alkema features a simple, working API using FasTAPI for customizing characters using LPC spritesheets. The only routes working are for setting body, face, hair, skin color and hair color. More features and gameplay elements are planned for future releases.

## Technology Stack

The core technology stack will include:

- [**Docker**](https://www.docker.com/) & [**Docker Compose**](https://docs.docker.com/compose/) for containerized deployment
- [**Caddy**](https://caddyserver.com/) for web serving and reverse proxy
- [**MongoDB**](https://www.mongodb.com/) for database management
- [**Redis**](https://redis.io/) for key-value storage and caching
- [**FastAPI**](https://fastapi.tiangolo.com/) for backend API services
- [**Socket.io**](https://socket.io/) for real-time communication
- [**Phaser**](https://phaser.io/) for browser-based game

## Features

- **LPC Character Customization:** Integrates the LPC SpriteSheet Generator for creating and customizing characters.
- **Open Source:** Contributions are welcome!

## Running Locally (Windows)

To run Alkema locally on Windows, use the provided batch script:

1. Make sure you have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
2. Open a terminal in the project directory.
3. Run:
   ```
   dev_run.bat
   ```
This will start the development environment using Docker and Docker Compose.

### Accessing the API

- Once the local development environment is running, the API will be available at:  
  [http://localhost:8000](http://localhost:8000)

- You can find the automatically generated API documentation (Swagger UI) at:  
  [http://localhost:8000/docs](http://localhost:8000/docs)

- Make requests to the API endpoints using tools like [Postman](https://www.postman.com/) or [curl](https://curl.se/), or directly from your browser for GET requests.

## Screenshots

Below are some example images from the LPC customizer:

![Example Character](Universal-LPC-Spritesheet-Character-Generator/readme-images/example.png)
![License Sheet](Universal-LPC-Spritesheet-Character-Generator/readme-images/credits-sheet.png)

## Credits

This project uses assets from the [Liberated Pixel Cup](https://lpc.opengameart.org) and the [Universal LPC Spritesheet Character Generator](Universal-LPC-Spritesheet-Character-Generator/README.md). Please see the [CREDITS.csv](Universal-LPC-Spritesheet-Character-Generator/CREDITS.csv) file for detailed attribution.

## License

See [Universal-LPC-Spritesheet-Character-Generator/LICENSE](Universal-LPC-Spritesheet-Character-Generator/LICENSE)

---

## Special Thanks

A big thanks to [OpenGameArt.org](https://opengameart.org/) and the LPC community for making these amazing tools and assets available