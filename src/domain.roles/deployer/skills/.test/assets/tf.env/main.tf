# a stand-in terraform environment directory.
#
# .what = the minimum a `provision.terraform` run needs to find on disk: a directory
#         under provision/aws/environments/<env>.
# .why  = the skill resolves that directory BEFORE it reads any credential, and it
#         belays (exit 2) when the directory is absent. tests symlink this one fixture
#         in under whichever env name the case needs — dev/, prep/, prod/, test/ — so
#         directory presence is a test-controlled variable and never an adhoc mkdir
#         (rule.forbid.adhoc-gentempdir-reimpl).
