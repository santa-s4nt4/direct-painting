"""Run from a Text DAT in the desired TouchDesigner component.
Web Render parameters: https://docs.derivative.ca/Web_Render_TOP
Existing operators are preserved; re-running updates the same two named TOPs.
"""

container = me.parent()
web = container.op('direct_painting_web')
if web is None:
    web = container.create(webrenderTOP, 'direct_painting_web')
web.par.url = 'http://localhost:5181/output'
web.par.outputresolution = 'custom'
web.par.resolutionw = 1920
web.par.resolutionh = 1080
web.par.resmult = False
web.par.active = True
web.par.alwayscook = True
web.nodeX, web.nodeY = 0, 0

out = container.op('direct_painting_out')
if out is None:
    out = container.create(nullTOP, 'direct_painting_out')
out.setInput(0, web)
out.nodeX, out.nodeY = 200, 0
out.viewer = True
web.par.reload.pulse()
print('direct-painting: 1920 × 1080 · http://localhost:5181/output')
